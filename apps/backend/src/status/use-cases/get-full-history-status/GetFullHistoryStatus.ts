import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export interface FullHistoryStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly mode: 'archive_header_parser';
	readonly parsedLedgerCount: number;
	readonly earliestParsedLedger: string | null;
	readonly latestParsedLedger: string | null;
	readonly latestObservedAt: string | null;
	readonly sourceArchiveCount: number;
	readonly localTransactionIndexReady: boolean;
	readonly localOperationIndexReady: boolean;
	readonly localAssetIndexReady: boolean;
	readonly localContractIndexReady: boolean;
}

export interface IngestionStatusDTO extends FullHistoryStatusDTO {
	readonly queue: {
		readonly doneJobs: number;
		readonly pendingJobs: number;
		readonly takenJobs: number;
		readonly latestJobUpdateAt: string | null;
	};
}

export interface IndexingJobDTO {
	readonly concurrency: number | null;
	readonly fromLedger: string | null;
	readonly latestScannedLedger: string;
	readonly remoteId: string;
	readonly status: 'DONE' | 'PENDING' | 'TAKEN';
	readonly toLedger: string | null;
	readonly updatedAt: string | null;
	readonly url: string;
}

export interface IndexingJobsDTO {
	readonly generatedAt: string;
	readonly jobs: readonly IndexingJobDTO[];
	readonly limit: number;
	readonly summary: IngestionStatusDTO['queue'];
}

export interface IndexingRangeDTO {
	readonly archiveUrl: string;
	readonly earliestParsedLedger: string;
	readonly latestObservedAt: string;
	readonly latestParsedLedger: string;
	readonly parsedLedgerCount: number;
}

export interface IndexingRangesDTO {
	readonly generatedAt: string;
	readonly limit: number;
	readonly ranges: readonly IndexingRangeDTO[];
}

export interface LedgerIngestionStatusDTO {
	readonly generatedAt: string;
	readonly header: {
		readonly bucketListHash: string;
		readonly ledgerHeaderHash: string;
		readonly protocolVersion: number;
		readonly sourceArchiveUrl: string;
		readonly transactionResultHash: string;
		readonly transactionSetHash: string;
	} | null;
	readonly ledger: string;
	readonly parsedHeaderAvailable: boolean;
	readonly status: 'parsed' | 'unparsed';
}

interface HeaderStatsRow {
	readonly earliestParsedLedger: string | null;
	readonly latestObservedAt: Date | string | null;
	readonly latestParsedLedger: string | null;
	readonly parsedLedgerCount: string | number;
	readonly sourceArchiveCount: string | number;
}

interface HeaderBoundaryRow {
	readonly ledgerSequence: number | string;
	readonly lastSeenAt: Date | string | null;
}

interface HeaderApproximateCountRow {
	readonly parsedLedgerCount: string | number | null;
}

interface SourceArchiveCountRow {
	readonly sourceArchiveCount: string | number | null;
}

interface QueueSummaryRow {
	readonly doneJobs: string | number | null;
	readonly latestJobUpdateAt: Date | string | null;
	readonly pendingJobs: string | number | null;
	readonly takenJobs: string | number | null;
}

interface JobRow {
	readonly concurrency: number | null;
	readonly fromLedger: number | string | null;
	readonly latestScannedLedger: number | string;
	readonly remoteId: string;
	readonly status: 'DONE' | 'PENDING' | 'TAKEN';
	readonly toLedger: number | string | null;
	readonly updatedAt: Date | string | null;
	readonly url: string;
}

interface RangeRow {
	readonly archiveUrl: string;
	readonly earliestParsedLedger: number | string;
	readonly latestObservedAt: Date | string;
	readonly latestParsedLedger: number | string;
	readonly parsedLedgerCount: string | number;
}

interface LedgerHeaderRow {
	readonly bucketListHash: string;
	readonly ledgerHeaderHash: string;
	readonly lastSourceArchiveUrl: string;
	readonly protocolVersion: number;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string;
}

@injectable()
export class GetFullHistoryStatus {
	constructor(@inject(DataSource) private readonly dataSource: DataSource) {}

	async executeFullHistory(): Promise<Result<FullHistoryStatusDTO, Error>> {
		try {
			return ok(this.mapFullHistory(await this.readHeaderStats()));
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeIngestion(): Promise<Result<IngestionStatusDTO, Error>> {
		try {
			const [stats, queue] = await Promise.all([
				this.readHeaderStats(),
				this.readQueueSummary()
			]);
			return ok({ ...this.mapFullHistory(stats), queue });
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeJobs(limit: number): Promise<Result<IndexingJobsDTO, Error>> {
		try {
			const [summary, jobs] = await Promise.all([
				this.readQueueSummary(),
				this.readJobs(limit)
			]);
			return ok({
				generatedAt: new Date().toISOString(),
				jobs,
				limit,
				summary
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeRanges(limit: number): Promise<Result<IndexingRangesDTO, Error>> {
		try {
			return ok({
				generatedAt: new Date().toISOString(),
				limit,
				ranges: await this.readRanges(limit)
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeLedger(
		sequence: string
	): Promise<Result<LedgerIngestionStatusDTO, Error>> {
		try {
			const rows = await this.dataSource.query<LedgerHeaderRow[]>(
				`
					select
						"ledgerHeaderHash",
						"transactionSetHash",
						"transactionResultHash",
						"bucketListHash",
						"protocolVersion",
						"lastSourceArchiveUrl"
					from parsed_ledger_header
					where "ledgerSequence" = $1
					order by "lastSeenAt" desc
					limit 1
				`,
				[sequence]
			);
			const row = rows[0] ?? null;
			return ok({
				generatedAt: new Date().toISOString(),
				header: row
					? {
							bucketListHash: row.bucketListHash,
							ledgerHeaderHash: row.ledgerHeaderHash,
							protocolVersion: row.protocolVersion,
							sourceArchiveUrl: row.lastSourceArchiveUrl,
							transactionResultHash: row.transactionResultHash,
							transactionSetHash: row.transactionSetHash
						}
					: null,
				ledger: sequence,
				parsedHeaderAvailable: row !== null,
				status: row ? 'parsed' : 'unparsed'
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	private async readHeaderStats(): Promise<HeaderStatsRow> {
		const [countRows, earliestRows, latestRows, sourceRows] = await Promise.all([
			this.dataSource.query<HeaderApproximateCountRow[]>(`
				select greatest(
					coalesce(nullif(stat.n_live_tup, 0), class.reltuples)::bigint,
					0
				) as "parsedLedgerCount"
				from pg_class class
				left join pg_stat_all_tables stat on stat.relid = class.oid
				where class.oid = 'parsed_ledger_header'::regclass
			`),
			this.dataSource.query<HeaderBoundaryRow[]>(`
				select
					"ledgerSequence",
					"lastSeenAt"
				from parsed_ledger_header
				order by "ledgerSequence" asc
				limit 1
			`),
			this.dataSource.query<HeaderBoundaryRow[]>(`
				select
					"ledgerSequence",
					"lastSeenAt"
				from parsed_ledger_header
				order by "ledgerSequence" desc
				limit 1
			`),
			this.dataSource.query<SourceArchiveCountRow[]>(`
				select count(distinct url) as "sourceArchiveCount"
				from history_archive_scan_v2
			`)
		]);
		const earliest = earliestRows[0];
		const latest = latestRows[0];
		return {
			earliestParsedLedger: toNullableString(earliest?.ledgerSequence),
			latestObservedAt: latest?.lastSeenAt ?? null,
			latestParsedLedger: toNullableString(latest?.ledgerSequence),
			parsedLedgerCount: toNumber(countRows[0]?.parsedLedgerCount),
			sourceArchiveCount: toNumber(sourceRows[0]?.sourceArchiveCount)
		};
	}

	private async readQueueSummary(): Promise<IngestionStatusDTO['queue']> {
		const rows = await this.dataSource.query<QueueSummaryRow[]>(`
			select
				count(*) filter (where status = 'DONE') as "doneJobs",
				count(*) filter (where status = 'PENDING') as "pendingJobs",
				count(*) filter (where status = 'TAKEN') as "takenJobs",
				max("updatedAt") as "latestJobUpdateAt"
			from history_archive_scan_job_queue
		`);
		const row = rows[0];
		return {
			doneJobs: toNumber(row?.doneJobs),
			latestJobUpdateAt: toIso(row?.latestJobUpdateAt),
			pendingJobs: toNumber(row?.pendingJobs),
			takenJobs: toNumber(row?.takenJobs)
		};
	}

	private async readJobs(limit: number): Promise<IndexingJobDTO[]> {
		const rows = await this.dataSource.query<JobRow[]>(
			`
				select
					"remoteId",
					url,
					status,
					"fromLedger",
					"toLedger",
					"latestScannedLedger",
					concurrency,
					"updatedAt"
				from history_archive_scan_job_queue
				order by "updatedAt" desc nulls last, id desc
				limit $1
			`,
			[limit]
		);
		return rows.map((row) => ({
			concurrency: row.concurrency,
			fromLedger: toNullableString(row.fromLedger),
			latestScannedLedger: toStringValue(row.latestScannedLedger),
			remoteId: row.remoteId,
			status: row.status,
			toLedger: toNullableString(row.toLedger),
			updatedAt: toIso(row.updatedAt),
			url: row.url
		}));
	}

	private async readRanges(limit: number): Promise<IndexingRangeDTO[]> {
		const rows = await this.dataSource.query<RangeRow[]>(
			`
				select
					"lastSourceArchiveUrl" as "archiveUrl",
					count(*) as "parsedLedgerCount",
					min("ledgerSequence") as "earliestParsedLedger",
					max("ledgerSequence") as "latestParsedLedger",
					max("lastSeenAt") as "latestObservedAt"
				from parsed_ledger_header
				group by "lastSourceArchiveUrl"
				order by max("lastSeenAt") desc
				limit $1
			`,
			[limit]
		);
		return rows.map((row) => ({
			archiveUrl: row.archiveUrl,
			earliestParsedLedger: toStringValue(row.earliestParsedLedger),
			latestObservedAt: toIso(row.latestObservedAt) ?? '',
			latestParsedLedger: toStringValue(row.latestParsedLedger),
			parsedLedgerCount: toNumber(row.parsedLedgerCount)
		}));
	}

	private mapFullHistory(row: HeaderStatsRow): FullHistoryStatusDTO {
		const parsedLedgerCount = toNumber(row.parsedLedgerCount);
		return {
			generatedAt: new Date().toISOString(),
			status: parsedLedgerCount > 0 ? 'degraded' : 'unavailable',
			mode: 'archive_header_parser',
			parsedLedgerCount,
			earliestParsedLedger: toNullableString(row.earliestParsedLedger),
			latestParsedLedger: toNullableString(row.latestParsedLedger),
			latestObservedAt: toIso(row.latestObservedAt),
			sourceArchiveCount: toNumber(row.sourceArchiveCount),
			localTransactionIndexReady: false,
			localOperationIndexReady: false,
			localAssetIndexReady: false,
			localContractIndexReady: false
		};
	}
}

const emptyHeaderStats: HeaderStatsRow = {
	earliestParsedLedger: null,
	latestObservedAt: null,
	latestParsedLedger: null,
	parsedLedgerCount: 0,
	sourceArchiveCount: 0
};

function toNumber(value: number | string | null | undefined): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return 0;
}

function toNullableString(
	value: number | string | null | undefined
): string | null {
	if (value === null || value === undefined) return null;
	return value.toString();
}

function toStringValue(value: number | string): string {
	return value.toString();
}

function toIso(value: Date | string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}
