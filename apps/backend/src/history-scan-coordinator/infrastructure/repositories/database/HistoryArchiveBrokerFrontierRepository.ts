import type { DataSource, EntityManager } from 'typeorm';
import type { HistoryArchiveObjectType } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { synchronizeHistoryArchiveReadyQueue } from './HistoryArchiveObjectReadyQueue.js';

const maximumArchiveSourceFrontierRows = 4_096;

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
	readonly remoteId: string;
}

const reserveBrokerJobsSql = `
	with active_hosts as materialized (
		select object."hostIdentity", count(*)::integer as active_count
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is not null
		group by object."hostIdentity"
	), ranked as materialized (
		select ready."objectRemoteId", ready."updatedAt", object."hostIdentity",
			coalesce(active.active_count, 0) as active_count,
			row_number() over (
				partition by object."hostIdentity"
				order by ready.priority, ready."availableAt", ready."updatedAt"
			) as host_rank
		from "history_archive_object_ready" ready
		join "history_archive_object_queue" object
			on object."remoteId" = ready."objectRemoteId"
		left join active_hosts active
			on active."hostIdentity" = object."hostIdentity"
		where ready."publishedAt" is null
			and ready."availableAt" <= now()
	), selected as materialized (
		select ranked."objectRemoteId"
		from ranked
		where ranked.active_count + ranked.host_rank <= $2::integer
		order by ranked.active_count, ranked.host_rank, ranked."updatedAt",
			ranked."objectRemoteId"
		limit $1::integer
	), reserved as (
		update "history_archive_object_ready" ready
		set "dispatchToken" = coalesce(ready."dispatchToken", gen_random_uuid()),
			"claimAttempt" = coalesce(ready."claimAttempt", object.attempts + 1),
			"updatedAt" = case
				when ready."dispatchToken" is null then now()
				else ready."updatedAt"
			end
		from "history_archive_object_queue" object
		where ready."objectRemoteId" = object."remoteId"
			and ready."objectRemoteId" in (
				select selected."objectRemoteId" from selected
			)
		returning
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
	select * from reserved
	order by "dispatchToken"
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
		}
	};
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
		maximumPerHost: number
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		return await this.dataSource.transaction(async (manager) => {
			await this.takeDispatcherLock(manager);
			const rows = (await manager.query(reserveBrokerJobsSql, [
				Math.floor(limit),
				Math.max(1, Math.floor(maximumPerHost))
			])) as readonly BrokerJobRow[];
			return rows.map(mapBrokerJob);
		});
	}

	async findPublishedJobs(
		limit: number
	): Promise<readonly HistoryArchiveBrokerJob[]> {
		if (limit < 1) return [];
		const rows = (await this.dataSource.query(
			`select ready."dispatchToken", ready."claimAttempt",
			        object."remoteId", object."archiveUrl", object."objectType",
			        object."objectKey", object."objectUrl",
			        object."checkpointLedger", object."bucketHash"
			 from "history_archive_object_ready" ready
			 join "history_archive_object_queue" object
			   on object."remoteId" = ready."objectRemoteId"
			 where ready."publishedAt" is not null
			   and ready."dispatchToken" is not null
			   and ready."claimAttempt" is not null
			 order by ready."updatedAt", ready."objectRemoteId"
			 limit $1::integer`,
			[Math.floor(limit)]
		)) as readonly BrokerJobRow[];
		return rows.map(mapBrokerJob);
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
