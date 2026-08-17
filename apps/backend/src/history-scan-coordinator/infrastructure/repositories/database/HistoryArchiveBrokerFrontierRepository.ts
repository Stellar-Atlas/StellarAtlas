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
import {
	canonicalRuntimePriorityCtesSql,
	historyArchiveReservationPrioritySql
} from './HistoryArchiveCanonicalRuntimePrioritySql.js';

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

const reserveBrokerJobsSql = `
	with ${canonicalRuntimePriorityCtesSql}, active_hosts as materialized (
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
			${historyArchiveReservationPrioritySql('ready', 'object')} as priority,
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
			and ${historyArchiveReservationPrioritySql('ready', 'object')} <=
				$3::smallint
			and (
				ready."dispatchToken" is not null
				or ready.priority =
					${historyArchiveReservationPrioritySql('ready', 'object')}
				or not exists (
					select 1
					from "history_archive_object_ready" frozen_lane
					where frozen_lane."archiveUrlIdentity" =
						ready."archiveUrlIdentity"
						and frozen_lane.priority =
							${historyArchiveReservationPrioritySql('ready', 'object')}
						and frozen_lane."objectRemoteId" <>
							ready."objectRemoteId"
						and (
							frozen_lane."dispatchToken" is not null
							or frozen_lane."publishedAt" is not null
						)
				)
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
	), deduplicated as materialized (
		select candidate.*
		from eligible candidate
		where candidate.stored_priority = candidate.priority
			or (
				not exists (
					select 1
					from eligible destination
					where destination."archiveUrlIdentity" =
						candidate."archiveUrlIdentity"
						and destination."objectRemoteId" <>
							candidate."objectRemoteId"
						and destination.stored_priority = candidate.priority
						and destination.priority = candidate.priority
				)
				and not exists (
					select 1
					from eligible preferred
					where preferred."archiveUrlIdentity" =
						candidate."archiveUrlIdentity"
						and preferred.stored_priority <> preferred.priority
						and (
							preferred.priority,
							preferred."updatedAt",
							preferred."objectRemoteId"
						) < (
							candidate.priority,
							candidate."updatedAt",
							candidate."objectRemoteId"
						)
				)
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
		from deduplicated candidate
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
	), displaced as (
		delete from "history_archive_object_ready" conflict
		using selected, "history_archive_object_ready" selected_ready
		where selected.stored_priority <> selected.priority
			and selected_ready."objectRemoteId" = selected."objectRemoteId"
			and conflict."archiveUrlIdentity" =
				selected_ready."archiveUrlIdentity"
			and conflict.priority = selected.priority
			and conflict."objectRemoteId" <> selected."objectRemoteId"
			and conflict."dispatchToken" is null
			and conflict."publishedAt" is null
		returning conflict."objectRemoteId"
	), displacement_fence as materialized (
		select count(*)::integer as count from displaced
	), reserved as (
		update "history_archive_object_ready" ready
		set "dispatchToken" = coalesce(ready."dispatchToken", gen_random_uuid()),
			priority = case
				when ready."dispatchToken" is null then selected.priority
				else ready.priority
			end,
			"claimAttempt" = coalesce(ready."claimAttempt", object.attempts + 1),
			"updatedAt" = case
				when ready."dispatchToken" is null then now()
				else ready."updatedAt"
			end
		from "history_archive_object_queue" object, selected,
			displacement_fence
		where ready."objectRemoteId" = object."remoteId"
			and ready."objectRemoteId" = selected."objectRemoteId"
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
	constructor(private readonly dataSource: DataSource) {}

	async ensureFrontier(): Promise<number> {
		return await this.dataSource.transaction(async (manager) => {
			const result = await synchronizeHistoryArchiveReadyQueue(
				manager,
				maximumArchiveSourceFrontierRows
			);
			return result.readyObjects;
		});
	}

	async reserveJobs(
		limit: number,
		maximumPerHost: number,
		maximumPriority: HistoryArchiveBrokerPriority = defaultHistoryArchiveBrokerMaximumPriority
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		return await this.dataSource.transaction(async (manager) => {
			await this.takeDispatcherLock(manager);
			const rows = (await manager.query(reserveBrokerJobsSql, [
				Math.floor(limit),
				Math.max(1, Math.floor(maximumPerHost)),
				requirePriority(maximumPriority)
			])) as readonly BrokerJobRow[];
			return mapAndOrderBrokerJobs(rows);
		});
	}

	async findPublishedJobs(
		limit: number,
		maximumPriority: HistoryArchiveBrokerPriority = defaultHistoryArchiveBrokerMaximumPriority
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		const rows = (await this.dataSource.query(findPublishedBrokerJobsSql, [
			Math.floor(limit),
			requirePriority(maximumPriority)
		])) as readonly BrokerJobRow[];
		return mapAndOrderBrokerJobs(rows);
	}

	async markPublished(executionIds: readonly string[]): Promise<void> {
		if (executionIds.length === 0) return;
		await this.dataSource.query(
			`update "history_archive_object_ready"
			 set "publishedAt" = coalesce("publishedAt", now()),
			     "updatedAt" = now()
			 where "dispatchToken" = any($1::uuid[])
			   and "publishedAt" is null`,
			[executionIds]
		);
	}

	private async takeDispatcherLock(manager: EntityManager): Promise<void> {
		await manager.query(
			`select pg_advisory_xact_lock(hashtextextended($1::text, 8191))`,
			['stellaratlas:history-archive-broker-dispatcher']
		);
	}
}
