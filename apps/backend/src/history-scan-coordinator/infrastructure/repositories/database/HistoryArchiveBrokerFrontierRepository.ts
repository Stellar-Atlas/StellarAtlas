import type { DataSource, EntityManager } from 'typeorm';
import {
	defaultHistoryArchiveBrokerMaximumPriority,
	type HistoryArchiveBrokerPriority
} from '../../../domain/history-archive-object/HistoryArchiveBrokerPriority.js';
import type { HistoryArchiveObjectType } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveCheckpointNotFoundCooldownSql,
	historyArchiveSchedulableObjectSql,
	synchronizeHistoryArchiveReadyQueue
} from './HistoryArchiveObjectReadyQueue.js';
import { enqueueCurrentTerminalReadyCheckpointProofRefreshes } from './HistoryArchiveCheckpointProofRefreshQueue.js';
import { materializeOrderedCheckpointPrefetch } from './HistoryArchiveCheckpointPrefetch.js';
import { historyArchiveExecutionReconciliationLockName } from './HistoryArchiveObjectExecutionReconciler.js';

const maximumArchiveSourceFrontierRows = 4_096;
const terminalProofRecoveryIntervalMs = 1_000;

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
	};
	readonly priority: HistoryArchiveBrokerPriority;
	readonly selectedOrdinal: number;
}

interface BrokerJobRow {
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

export const reserveBrokerJobsSql = `
	with canonical_scope as materialized (
		select exists (
			select 1
			from "history_archive_checkpoint_scan_cursor" canonical_cursor
			join "history_archive_state_snapshot" canonical_state
				on canonical_state."archiveUrlIdentity" =
					canonical_cursor."archiveUrlIdentity"
			where $4::text is not null
				and canonical_cursor."archiveUrlIdentity" = $4::text
				and (
					canonical_cursor."nextHistoricalCheckpointLedger" <=
						(
							floor((canonical_state."currentLedger" + 1)::numeric / 64)
							* 64 - 1
						)::integer
					or not exists (
						select 1
						from "history_archive_checkpoint_proof" canonical_proof
						where canonical_proof."archiveUrlIdentity" = $4::text
							and canonical_proof."checkpointLedger" =
								(
									floor((canonical_state."currentLedger" + 1)::numeric / 64)
									* 64 - 1
								)::integer
							and canonical_proof.status = 'verified'
					)
				)
		) as incomplete
	), active_hosts as materialized (
		select object."hostIdentity", count(*)::integer as active_count
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is not null
		group by object."hostIdentity"
	), eligible as materialized (
		select ready."objectRemoteId",
			ready."archiveUrlIdentity",
			ready.priority as stored_priority,
			ready.priority as priority,
			ready."dispatchToken",
			ready."updatedAt",
			object."hostIdentity",
			coalesce(active.active_count, 0) as active_count
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		left join active_hosts active
			on active."hostIdentity" = object."hostIdentity"
		where ready."publishedAt" is null
			and ready."availableAt" <= now()
			and (
				ready."dispatchToken" is not null
				or (${historyArchiveSchedulableObjectSql('object')})
			)
			and ready.priority <= $3::smallint
			and (
				ready."dispatchToken" is not null
				or $4::text is null
				or not (select incomplete from canonical_scope)
				or ready."archiveUrlIdentity" = $4::text
			)
			and not exists (
				select 1
				from "history_archive_object_host_throttle" throttle
				where throttle."hostIdentity" = object."hostIdentity"
					and throttle."blockedUntil" > now()
			)
			and (
				ready."dispatchToken" is not null
				or ${historyArchiveCheckpointNotFoundCooldownSql('object')}
			)
	), ranked as materialized (
		select candidate."objectRemoteId", candidate.priority,
			candidate.stored_priority, candidate."updatedAt",
			candidate."hostIdentity", candidate.active_count,
			row_number() over (
				partition by candidate."hostIdentity"
				order by candidate.priority, candidate."updatedAt",
					candidate."objectRemoteId"
			) as host_rank
		from eligible candidate
	), selected as materialized (
		select ranked."objectRemoteId", ranked.priority,
			ranked.stored_priority,
			(row_number() over (
				order by ranked.priority, ranked.active_count,
					ranked.host_rank, ranked."updatedAt",
					ranked."objectRemoteId"
			))::integer as "selectedOrdinal"
		from ranked
		where ranked.active_count + ranked.host_rank <= $2::integer
		order by ranked.priority, ranked.active_count, ranked.host_rank,
			ranked."updatedAt",
			ranked."objectRemoteId"
		limit $1::integer
	), lockable as materialized (
		select ready."objectRemoteId"
		from "history_archive_object_ready" ready
		join selected
			on selected."objectRemoteId" = ready."objectRemoteId"
		order by selected.priority, selected."selectedOrdinal",
			ready."objectRemoteId"
		for update of ready skip locked
	), reserved as (
		update "history_archive_object_ready" ready
		set "dispatchToken" = coalesce(ready."dispatchToken", gen_random_uuid()),
			priority = case
				when ready."dispatchToken" is null then selected.priority
				else ready.priority
			end,
			"claimAttempt" = coalesce(ready."claimAttempt", object.attempts + 1),
			"publishedAt" = now(),
			"updatedAt" = now()
		from "history_archive_object_queue" object, selected, lockable
		where ready."objectRemoteId" = object."remoteId"
			and ready."objectRemoteId" = selected."objectRemoteId"
			and ready."objectRemoteId" = lockable."objectRemoteId"
		returning
			ready."objectRemoteId",
			ready."dispatchToken",
			ready."claimAttempt",
			object."remoteId",
			object."archiveUrl",
			object."objectType",
			object."objectKey",
			object."objectUrl",
			object."checkpointLedger",
			object."bucketHash"
	)
	select reserved."dispatchToken", reserved."claimAttempt",
		reserved."remoteId", reserved."archiveUrl", reserved."objectType",
		reserved."objectKey", reserved."objectUrl",
		reserved."checkpointLedger", reserved."bucketHash",
		selected.priority, selected."selectedOrdinal"
	from reserved
	join selected
		on selected."objectRemoteId" = reserved."objectRemoteId"
	order by selected.priority, selected."selectedOrdinal"
`;

const findPublishedBrokerJobsSql = `
	select published."dispatchToken", published."claimAttempt",
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
			object."remoteId", object."archiveUrl", object."objectType",
			object."objectKey", object."objectUrl",
			object."checkpointLedger", object."bucketHash"
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is not null
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
			remoteId: row.remoteId
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
	private nextTerminalProofRecoveryAt = 0;

	constructor(private readonly dataSource: DataSource) {}

	async ensurePrefetch(
		archiveUrlIdentity: string | null = null
	): Promise<number> {
		return await this.dataSource.transaction(async (manager) => {
			if (!(await this.tryTakeExecutionReconciliationLock(manager))) return 0;
			return await materializeOrderedCheckpointPrefetch(
				manager,
				archiveUrlIdentity
			);
		});
	}

	async ensureFrontier(
		archiveUrlIdentity: string | null = null
	): Promise<number> {
		const materialized = await this.dataSource.transaction(async (manager) => {
			if (!(await this.tryTakeExecutionReconciliationLock(manager)))
				return false;
			await materializeOrderedCheckpointPrefetch(manager, archiveUrlIdentity);
			return true;
		});
		if (!materialized) return 0;
		const readyObjects = await this.dataSource.transaction(async (manager) => {
			const result = await synchronizeHistoryArchiveReadyQueue(
				manager,
				maximumArchiveSourceFrontierRows
			);
			return result.readyObjects;
		});
		await this.ensureProofFrontier();
		return readyObjects;
	}

	async ensureProofFrontier(): Promise<void> {
		const now = Date.now();
		if (now < this.nextTerminalProofRecoveryAt) return;
		this.nextTerminalProofRecoveryAt = now + terminalProofRecoveryIntervalMs;
		try {
			await this.dataSource.transaction(async (manager) => {
				await enqueueCurrentTerminalReadyCheckpointProofRefreshes(
					manager,
					maximumArchiveSourceFrontierRows
				);
			});
		} catch (error) {
			this.nextTerminalProofRecoveryAt = 0;
			throw error;
		}
	}

	async reserveJobs(
		limit: number,
		maximumPerHost: number,
		maximumPriority: HistoryArchiveBrokerPriority = defaultHistoryArchiveBrokerMaximumPriority,
		canonicalFirstRoot: string | null = null
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		return await this.dataSource.transaction(async (manager) => {
			await this.takeDispatcherLock(manager);
			const rows = (await manager.query(reserveBrokerJobsSql, [
				Math.floor(limit),
				Math.max(1, Math.floor(maximumPerHost)),
				requirePriority(maximumPriority),
				canonicalFirstRoot
			])) as readonly BrokerJobRow[];
			return mapAndOrderBrokerJobs(rows);
		});
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
