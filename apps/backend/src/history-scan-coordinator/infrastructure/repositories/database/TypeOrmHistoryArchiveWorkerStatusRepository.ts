import { injectable } from 'inversify';
import type { EntityManager, Repository } from 'typeorm';
import {
	historyArchiveWorkerSlotCount,
	type HistoryArchiveWorkerReportDTO
} from 'history-scanner-dto';
import type {
	HistoryArchiveWorkerStatus,
	HistoryArchiveWorkerStatusRepository
} from '@history-scan-coordinator/domain/history-archive-worker/HistoryArchiveWorkerStatus.js';
import {
	decodeHistoryArchiveObjectType,
	decodeHistoryArchiveWorkerOutcome,
	decodeHistoryArchiveWorkerStage,
	encodeHistoryArchiveObjectType,
	encodeHistoryArchiveWorkerOutcome,
	encodeHistoryArchiveWorkerStage
} from '@history-scan-coordinator/domain/history-archive-worker/HistoryArchiveWorkerStatusCodes.js';
import { HistoryArchiveWorkerStatusRow } from '../../database/entities/HistoryArchiveWorkerStatusRow.js';

export const historyArchiveWorkerRegistryMaxRows = 128;
export const historyArchiveWorkerRegistryLockTimeoutMs = 2_000;
export const historyArchiveWorkerRegistryStatementTimeoutMs = 5_000;

export const historyArchiveWorkerStatusTimeoutSql = `
	select
		set_config('lock_timeout', $1::text, true),
		set_config('statement_timeout', $2::text, true)
`;

export const historyArchiveWorkerStatusRegistryLockSql = `
	select pg_advisory_xact_lock(1784790000, 1)
`;

export const historyArchiveWorkerStatusUpsertSql = `
	insert into "history_archive_worker_status" as registry (
		"workerId",
		"slotIndex",
		"processId",
		"pid",
		"processGeneration",
		"processStartedAt",
		"sequence",
		"objectRemoteId",
		"objectTypeCode",
		"objectSource",
		"stageCode",
		"bytesDownloaded",
		"bytesTotal",
		"claimAttempt",
		"heartbeatAt",
		"lastOutcomeCode",
		"lastOutcomeAt"
	) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
	on conflict ("workerId") do update set
		"slotIndex" = excluded."slotIndex",
		"processId" = excluded."processId",
		"pid" = excluded."pid",
		"processGeneration" = excluded."processGeneration",
		"processStartedAt" = excluded."processStartedAt",
		"sequence" = excluded."sequence",
		"objectRemoteId" = excluded."objectRemoteId",
		"objectTypeCode" = excluded."objectTypeCode",
		"objectSource" = excluded."objectSource",
		"stageCode" = excluded."stageCode",
		"bytesDownloaded" = excluded."bytesDownloaded",
		"bytesTotal" = excluded."bytesTotal",
		"claimAttempt" = excluded."claimAttempt",
		"heartbeatAt" = excluded."heartbeatAt",
		"lastOutcomeCode" = excluded."lastOutcomeCode",
		"lastOutcomeAt" = excluded."lastOutcomeAt"
	where
		registry."processStartedAt" < excluded."processStartedAt"
		or (
			registry."processStartedAt" = excluded."processStartedAt"
			and registry."processGeneration" < excluded."processGeneration"
		)
		or (
			registry."processStartedAt" = excluded."processStartedAt"
			and registry."processGeneration" = excluded."processGeneration"
			and registry."processId" < excluded."processId"
		)
		or (
			registry."processStartedAt" = excluded."processStartedAt"
			and registry."processGeneration" = excluded."processGeneration"
			and registry."processId" = excluded."processId"
			and registry."sequence" < excluded."sequence"
		)
`;

export const historyArchiveWorkerStatusPruneSql = `
	with ranked as materialized (
		select
			"id",
			"heartbeatAt",
			"processStartedAt",
			"processGeneration",
			"processId",
			"sequence",
			row_number() over (
				order by
					"heartbeatAt" desc,
					"processStartedAt" desc,
					"processGeneration" desc,
					"sequence" desc,
					"workerId" asc
			) as ordinal
		from "history_archive_worker_status"
	)
	delete from "history_archive_worker_status" as registry
	using ranked
	where registry."id" = ranked."id"
		and registry."heartbeatAt" = ranked."heartbeatAt"
		and registry."processStartedAt" = ranked."processStartedAt"
		and registry."processGeneration" = ranked."processGeneration"
		and registry."processId" = ranked."processId"
		and registry."sequence" = ranked."sequence"
		and (ranked."heartbeatAt" < $1 or ranked.ordinal > $2)
`;

export const historyArchiveWorkerStatusFindRecentSql = `
	select
		"workerId",
		"slotIndex",
		"processId",
		"pid",
		"processGeneration",
		"processStartedAt",
		"sequence",
		"objectRemoteId",
		"objectTypeCode",
		"objectSource",
		"stageCode",
		"bytesDownloaded",
		"bytesTotal",
		"claimAttempt",
		"heartbeatAt",
		"lastOutcomeCode",
		"lastOutcomeAt"
	from "history_archive_worker_status"
	where "heartbeatAt" >= $1
	order by
		"slotIndex" asc,
		"heartbeatAt" desc,
		"processStartedAt" desc,
		"processGeneration" desc,
		"sequence" desc,
		"workerId" asc
	limit $2
`;

interface HistoryArchiveWorkerStatusRawRow {
	readonly bytesDownloaded: number | string | null;
	readonly bytesTotal: number | string | null;
	readonly claimAttempt: number | null;
	readonly heartbeatAt: Date | string;
	readonly lastOutcomeAt: Date | string | null;
	readonly lastOutcomeCode: number;
	readonly objectRemoteId: string | null;
	readonly objectSource: string | null;
	readonly objectTypeCode: number | null;
	readonly pid: number;
	readonly processGeneration: number;
	readonly processId: string;
	readonly processStartedAt: Date | string;
	readonly sequence: number | string;
	readonly slotIndex: number;
	readonly stageCode: number;
	readonly workerId: string;
}

@injectable()
export class TypeOrmHistoryArchiveWorkerStatusRepository implements HistoryArchiveWorkerStatusRepository {
	constructor(
		private readonly repository: Repository<HistoryArchiveWorkerStatusRow>
	) {}

	async report(
		report: HistoryArchiveWorkerReportDTO,
		heartbeatAt: Date
	): Promise<void> {
		const currentObject = report.currentObject;
		await this.repository.manager.transaction(async (manager) => {
			await setWorkerRegistryTimeouts(manager);
			await manager.query(historyArchiveWorkerStatusUpsertSql, [
				report.workerId,
				report.slotIndex,
				report.processId,
				report.pid,
				report.processGeneration,
				new Date(report.processStartedAt),
				report.sequence,
				currentObject?.remoteId ?? null,
				encodeHistoryArchiveObjectType(currentObject?.type ?? null),
				currentObject?.source ?? null,
				encodeHistoryArchiveWorkerStage(report.stage),
				report.bytesDownloaded,
				report.bytesTotal ?? null,
				report.claimAttempt,
				heartbeatAt,
				encodeHistoryArchiveWorkerOutcome(report.lastOutcome),
				report.lastOutcomeAt === null ? null : new Date(report.lastOutcomeAt)
			]);
		});
	}

	async findRecent(options: {
		readonly limit: number;
		readonly observedAfter: Date;
		readonly pruneBefore: Date;
	}): Promise<readonly HistoryArchiveWorkerStatus[]> {
		const rows = await this.repository.manager.transaction(async (manager) => {
			await setWorkerRegistryTimeouts(manager);
			await manager.query(historyArchiveWorkerStatusRegistryLockSql);
			await manager.query(historyArchiveWorkerStatusPruneSql, [
				options.pruneBefore,
				historyArchiveWorkerRegistryMaxRows
			]);
			return manager.query<HistoryArchiveWorkerStatusRawRow[]>(
				historyArchiveWorkerStatusFindRecentSql,
				[options.observedAfter, normalizeLimit(options.limit)]
			);
		});

		return rows.map(mapRow);
	}
}

async function setWorkerRegistryTimeouts(
	manager: EntityManager
): Promise<void> {
	await manager.query(historyArchiveWorkerStatusTimeoutSql, [
		`${historyArchiveWorkerRegistryLockTimeoutMs}ms`,
		`${historyArchiveWorkerRegistryStatementTimeoutMs}ms`
	]);
}

function mapRow(
	row: HistoryArchiveWorkerStatusRawRow
): HistoryArchiveWorkerStatus {
	const objectType = decodeHistoryArchiveObjectType(row.objectTypeCode);
	const currentObject =
		row.objectRemoteId === null ||
		row.objectSource === null ||
		objectType === null
			? null
			: {
					remoteId: row.objectRemoteId,
					source: row.objectSource,
					type: objectType
				};

	return {
		bytesDownloaded: toSafeByteCount(row.bytesDownloaded, 'downloaded bytes'),
		bytesTotal: toSafeByteCount(row.bytesTotal, 'total bytes'),
		claimAttempt: row.claimAttempt,
		currentObject,
		heartbeatAt: toDate(row.heartbeatAt),
		lastOutcome: decodeHistoryArchiveWorkerOutcome(row.lastOutcomeCode),
		lastOutcomeAt:
			row.lastOutcomeAt === null ? null : toDate(row.lastOutcomeAt),
		pid: row.pid,
		processGeneration: row.processGeneration,
		processId: row.processId,
		processStartedAt: toDate(row.processStartedAt),
		sequence: toPositiveSafeNumber(row.sequence, 'sequence'),
		slotIndex: toWorkerSlotIndex(row.slotIndex),
		stage: decodeHistoryArchiveWorkerStage(row.stageCode),
		workerId: row.workerId
	};
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) {
		return historyArchiveWorkerRegistryMaxRows;
	}

	return Math.min(limit, historyArchiveWorkerRegistryMaxRows);
}

function toDate(value: Date | string): Date {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error('Invalid history archive worker status date');
	}

	return date;
}

function toSafeByteCount(
	value: number | string | null,
	field: string
): number | null {
	if (value === null) return null;
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new Error(`Invalid history archive worker ${field}`);
	}

	return number;
}

function toWorkerSlotIndex(value: number): number {
	if (
		!Number.isSafeInteger(value) ||
		value < 0 ||
		value >= historyArchiveWorkerSlotCount
	) {
		throw new Error('Invalid history archive worker slot index');
	}
	return value;
}

function toPositiveSafeNumber(value: number | string, field: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) {
		throw new Error(`Invalid history archive worker ${field}`);
	}

	return number;
}
