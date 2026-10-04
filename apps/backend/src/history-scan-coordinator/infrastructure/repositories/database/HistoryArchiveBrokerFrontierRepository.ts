import type { DataSource, EntityManager } from 'typeorm';
import { historyArchiveRootControlAllowedSql } from './HistoryArchiveRootFailureControl.js';
import { maintainHistoryArchiveAdaptiveProbes } from './HistoryArchiveAdaptiveProbeMaintenance.js';
import {
	admitDailyTransientSourceRetries,
	historyArchiveManualOrAutomaticSourceRetrySql
} from './HistoryArchiveTransientSourceRetry.js';
import { recoverMissingFrontierReady } from './HistoryArchiveMissingFrontierReady.js';
import { withBoundedArchiveBrokerMaintenance } from './BoundedArchiveBrokerMaintenance.js';
import {
	defaultHistoryArchiveBrokerMaximumPriority,
	type HistoryArchiveBrokerPriority
} from '../../../domain/history-archive-object/HistoryArchiveBrokerPriority.js';
import type { HistoryArchiveObjectType } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	notifyHistoryArchiveReadyWork,
	synchronizeHistoryArchiveReadyQueue
} from './HistoryArchiveObjectReadyQueue.js';
import {
	reserveBrokerJobsSql,
	reserveBrokerSingleSlotRetrySql
} from './HistoryArchiveBrokerReservationSql.js';
export { reserveBrokerJobsSql } from './HistoryArchiveBrokerReservationSql.js';
import { activateCurrentCheckpointDependencies } from './HistoryArchiveCheckpointPrefetch.js';
import { materializeCompactCheckpointPlanResult } from './HistoryArchiveCompactPlanning.js';
import { historyArchiveExecutionReconciliationLockName } from './HistoryArchiveObjectExecutionReconciler.js';

const maximumArchiveSourceFrontierRows = 4_096;

export type { HistoryArchiveBrokerPriority } from '../../../domain/history-archive-object/HistoryArchiveBrokerPriority.js';

export interface HistoryArchiveBrokerJob {
	readonly executionId: string;
	readonly job: {
		readonly archiveUrl: string;
		readonly bucketHash: string | null;
		readonly checkpointLedger: number | null;
		readonly claimAttempt: number;
		readonly objectKey: string;
		readonly objectType: HistoryArchiveObjectType;
		readonly objectUrl: string;
		readonly remoteId: string;
		readonly allowListingDiscovery?: boolean;
	};
	readonly priority: HistoryArchiveBrokerPriority;
	readonly selectedOrdinal: number;
}

interface BrokerJobRow {
	readonly allowListingDiscovery?: boolean;
	readonly archiveUrl: string;
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | string | null;
	readonly claimAttempt: number | string;
	readonly dispatchToken: string;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectType;
	readonly objectUrl: string;
	readonly priority: number | string;
	readonly remoteId: string;
	readonly selectedOrdinal: number | string;
}

const findPublishedBrokerJobsSql = `
	select published."dispatchToken", published."claimAttempt",
		exists (select 1 from history_archive_root_failure_control control
			where control."archiveUrlIdentity"=published."archiveUrlIdentity"
				and control.scope='checkpoint-state' and control."failureKind"='missing'
				and control."consecutiveFailures">=3 and control."probeExecutionId"=published."dispatchToken"
				and (control."listingCheckedAt" is null or control."listingCheckedAt"<=now()-interval '24 hours')) as "allowListingDiscovery",
		published.priority,
		(row_number() over (
			order by published.priority, published."updatedAt",
				published."objectRemoteId"
		))::integer as "selectedOrdinal",
		published."remoteId", published."archiveUrl", published."objectType",
		published."objectKey", published."objectUrl",
		published."checkpointLedger", published."bucketHash"
	from (
		select ready."dispatchToken", ready."claimAttempt",
			ready.priority,
			ready."updatedAt", ready."objectRemoteId",
			object."remoteId", object."archiveUrl", object."archiveUrlIdentity", object."objectType",
			object."objectKey", object."objectUrl",
			object."checkpointLedger", object."bucketHash"
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is not null
			and ${historyArchiveManualOrAutomaticSourceRetrySql('object', 'ready')}
			and ${historyArchiveRootControlAllowedSql('object', 'ready')}
			and ready."dispatchToken" is not null
			and ready."claimAttempt" is not null
                        and ready."claimAttempt" = object.attempts + 1
			and ($3::timestamptz is null
				or ready."publishedAt" <= $3::timestamptz)
	) published
	where published.priority <= $2::smallint
	order by published.priority, published."updatedAt",
		published."objectRemoteId"
	limit $1::integer
`;

const requeueOrphanedPublishedBrokerJobsSql = `
	with orphaned as materialized (
		select ready."objectRemoteId"
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" <= $1::timestamptz
			and ready."dispatchToken" is not null
			and ready."claimAttempt" is not null
			and ready."claimAttempt" = object.attempts + 1
			and object.status in ('pending', 'failed')
		order by ready."archiveUrlIdentity", ready."objectRemoteId"
		limit $2::integer
		for update of ready skip locked
	), requeued as (
		update "history_archive_object_ready" ready
		set "publishedAt" = null,
			"dispatchToken" = null,
			"recheckRequestedAt" = null,
			"claimAttempt" = null,
			"updatedAt" = now()
		from orphaned
		where ready."objectRemoteId" = orphaned."objectRemoteId"
		returning ready."objectRemoteId"
	)
	select count(*)::integer as count
	from requeued
`;

function requirePositiveInteger(value: number | string, field: string): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error(`Invalid archive broker ${field}`);
	return parsed;
}

function nullableInteger(
	value: number | string | null,
	field: string
): number | null {
	if (value === null) return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw new Error(`Invalid archive broker ${field}`);
	return parsed;
}

function requirePriority(value: number | string): HistoryArchiveBrokerPriority {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (parsed !== 0 && parsed !== 1 && parsed !== 2)
		throw new Error('Invalid archive broker priority');
	return parsed;
}

function mapBrokerJob(row: BrokerJobRow): HistoryArchiveBrokerJob {
	return {
		executionId: row.dispatchToken,
		job: {
			archiveUrl: row.archiveUrl,
			bucketHash: row.bucketHash,
			checkpointLedger: nullableInteger(
				row.checkpointLedger,
				'checkpointLedger'
			),
			claimAttempt: requirePositiveInteger(row.claimAttempt, 'claimAttempt'),
			objectKey: row.objectKey,
			objectType: row.objectType,
			objectUrl: row.objectUrl,
			remoteId: row.remoteId,
			allowListingDiscovery: row.allowListingDiscovery === true
		},
		priority: requirePriority(row.priority),
		selectedOrdinal: requirePositiveInteger(
			row.selectedOrdinal,
			'selectedOrdinal'
		)
	};
}

export function compareHistoryArchiveBrokerJobs(
	left: HistoryArchiveBrokerJob,
	right: HistoryArchiveBrokerJob
): number {
	if (left.priority !== right.priority) return left.priority - right.priority;
	if (left.selectedOrdinal !== right.selectedOrdinal)
		return left.selectedOrdinal - right.selectedOrdinal;
	return left.executionId < right.executionId
		? -1
		: left.executionId > right.executionId
			? 1
			: 0;
}

function mapAndOrderBrokerJobs(
	rows: readonly BrokerJobRow[]
): readonly HistoryArchiveBrokerJob[] {
	return rows.map(mapBrokerJob).sort(compareHistoryArchiveBrokerJobs);
}

export class HistoryArchiveBrokerFrontierRepository {
	private preferRetryOnSingleSlot = false;
	constructor(
		private readonly dataSource: DataSource,
		private readonly onMaintenanceDeferred?: (code: string) => void
	) {}

	async recoverMissingFrontierReady(limit: number): Promise<number> {
		return await this.dataSource.transaction(async (manager) => {
			await manager.query(
				"set local lock_timeout = '250ms'; set local statement_timeout = '2s'"
			);
			return await recoverMissingFrontierReady(manager, limit);
		});
	}

	private nextTransientSourceSweepAt = 0;
	async admitDailyTransientSourceRetries(limit: number): Promise<number> {
		if (limit < 1 || Date.now() < this.nextTransientSourceSweepAt) return 0;
		this.nextTransientSourceSweepAt = Date.now() + 1_000;
		const result = await withBoundedArchiveBrokerMaintenance(
			this.dataSource,
			async (manager) => {
				let nextSweepAt = 0;
				const admitted = await admitDailyTransientSourceRetries(
					manager,
					limit,
					(time) => {
						nextSweepAt = time;
					}
				);
				return { admitted, nextSweepAt };
			},
			{ admitted: 0, nextSweepAt: Date.now() + 60_000 },
			this.onMaintenanceDeferred
		).catch((error: unknown) => {
			// Optional retry maintenance must never stop ordinary reservations.
			const code =
				typeof error === 'object' &&
				error !== null &&
				'code' in error &&
				typeof error.code === 'string'
					? error.code
					: 'TRANSIENT_RETRY_UNAVAILABLE';
			this.onMaintenanceDeferred?.(code);
			return { admitted: 0, nextSweepAt: Date.now() + 60_000 };
		});
		this.nextTransientSourceSweepAt = Math.max(
			this.nextTransientSourceSweepAt,
			result.nextSweepAt
		);
		return result.admitted;
	}

	async ensurePrefetch(
		archiveUrlIdentity: string | null = null
	): Promise<number> {
		return await withBoundedArchiveBrokerMaintenance(
			this.dataSource,
			async (manager) => {
				if (!(await this.tryTakeExecutionReconciliationLock(manager))) return 0;
				return await this.materializeFrontier(manager, archiveUrlIdentity);
			},
			0,
			this.onMaintenanceDeferred
		);
	}

	async ensureFrontier(
		archiveUrlIdentity: string | null = null
	): Promise<number> {
		const materialized = await withBoundedArchiveBrokerMaintenance(
			this.dataSource,
			async (manager) => {
				if (!(await this.tryTakeExecutionReconciliationLock(manager)))
					return false;
				await this.materializeFrontier(manager, archiveUrlIdentity);
				return true;
			},
			false,
			this.onMaintenanceDeferred
		);
		if (!materialized) return 0;
		const readyObjects = await withBoundedArchiveBrokerMaintenance(
			this.dataSource,
			async (manager) => {
				const result = await synchronizeHistoryArchiveReadyQueue(
					manager,
					maximumArchiveSourceFrontierRows
				);
				return result.readyObjects;
			},
			0,
			this.onMaintenanceDeferred
		);
		return readyObjects;
	}

	async reserveJobs(
		limit: number,
		maximumPerHost: number,
		maximumPriority: HistoryArchiveBrokerPriority = defaultHistoryArchiveBrokerMaximumPriority,
		canonicalFirstRoot: string | null = null
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		await this.maintainAdaptiveProbes(limit);
		return await this.dataSource.transaction(async (manager) => {
			await this.takeDispatcherLock(manager);
			// Ephemeral fairness only: no sequence/table write per dispatch. The
			// existing dispatcher mutex serializes reservations in this process.
			const singleSlot = Math.floor(limit) === 1;
			const sql =
				singleSlot && this.preferRetryOnSingleSlot
					? reserveBrokerSingleSlotRetrySql
					: reserveBrokerJobsSql;
			if (singleSlot)
				this.preferRetryOnSingleSlot = !this.preferRetryOnSingleSlot;
			const rows = (await manager.query(sql, [
				Math.floor(limit),
				Math.max(1, Math.floor(maximumPerHost)),
				requirePriority(maximumPriority),
				canonicalFirstRoot
			])) as readonly BrokerJobRow[];
			return mapAndOrderBrokerJobs(rows);
		});
	}

	private nextAdaptiveMaintenanceAt = 0;
	private async maintainAdaptiveProbes(limit: number): Promise<void> {
		if (Date.now() < this.nextAdaptiveMaintenanceAt) return;
		this.nextAdaptiveMaintenanceAt = Date.now() + 1_000;
		const result = await withBoundedArchiveBrokerMaintenance(
			this.dataSource,
			(manager) =>
				maintainHistoryArchiveAdaptiveProbes(manager, Math.min(limit, 16)),
			-1,
			this.onMaintenanceDeferred
		).catch(() => -1);
		if (result < 0) this.nextAdaptiveMaintenanceAt = Date.now() + 60_000;
	}

	async findPublishedJobs(
		limit: number,
		maximumPriority: HistoryArchiveBrokerPriority = defaultHistoryArchiveBrokerMaximumPriority,
		_canonicalFirstRoot: string | null = null,
		publishedBefore: Date | null = null
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		const rows = (await this.dataSource.query(findPublishedBrokerJobsSql, [
			Math.floor(limit),
			requirePriority(maximumPriority),
			publishedBefore
		])) as readonly BrokerJobRow[];
		return mapAndOrderBrokerJobs(rows);
	}

	async requeueOrphanedPublishedJobs(
		publishedBefore: Date,
		limit: number
	): Promise<number> {
		if (limit < 1) return 0;
		return await this.dataSource.transaction(async (manager) => {
			await this.takeDispatcherLock(manager);
			const [requeued] = (await manager.query(
				requeueOrphanedPublishedBrokerJobsSql,
				[publishedBefore, Math.floor(limit)]
			)) as readonly { readonly count?: number | string }[];
			const count = Number(requeued?.count ?? 0);
			if (!Number.isSafeInteger(count) || count < 0) {
				throw new Error('Invalid orphaned archive broker job count');
			}
			if (count > 0) await notifyHistoryArchiveReadyWork(manager);
			return count;
		});
	}

	async resetPublished(executionIds: readonly string[]): Promise<void> {
		if (executionIds.length === 0) return;
		await this.dataSource.transaction(async (manager) => {
			await manager.query(
				`with failed_publish as materialized (
                                        select ready."objectRemoteId"
                                        from "history_archive_object_ready" ready
                                        where ready."dispatchToken" = any($1::uuid[])
                                                and ready."publishedAt" is not null
                                        order by ready."archiveUrlIdentity",
                                                ready."objectRemoteId"
                                        for update of ready
                                )
                                update "history_archive_object_ready" ready
                                set "publishedAt" = null,
                                        "updatedAt" = now()
                                from failed_publish
                                where ready."objectRemoteId" = failed_publish."objectRemoteId"`,
				[executionIds]
			);
		});
	}

	private async materializeFrontier(
		manager: EntityManager,
		archiveUrlIdentity: string | null
	): Promise<number> {
		const compactPlan = await materializeCompactCheckpointPlanResult(
			manager,
			archiveUrlIdentity === null ? null : [archiveUrlIdentity]
		);
		const activation = await activateCurrentCheckpointDependencies(
			manager,
			archiveUrlIdentity
		);
		if (activation.ready > 0) await notifyHistoryArchiveReadyWork(manager);
		return compactPlan.planned + activation.activated;
	}

	private async tryTakeExecutionReconciliationLock(
		manager: EntityManager
	): Promise<boolean> {
		const [lock] = (await manager.query(
			`select pg_try_advisory_xact_lock(hashtext($1)) as locked`,
			[historyArchiveExecutionReconciliationLockName]
		)) as readonly { readonly locked?: boolean }[];
		return lock?.locked === true;
	}

	private async takeDispatcherLock(manager: EntityManager): Promise<void> {
		await manager.query(
			`select pg_advisory_xact_lock(hashtextextended($1::text, 8191))`,
			['stellaratlas:history-archive-broker-dispatcher']
		);
	}
}
