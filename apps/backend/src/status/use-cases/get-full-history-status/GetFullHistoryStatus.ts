import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { DataSource } from 'typeorm';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { Config } from '@core/config/Config.js';
import type {
	FullHistoryCanonicalCoverageView,
	FullHistoryCanonicalRepository
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import type { FullHistoryOperationCoverage } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperation.js';
import type {
	FullHistoryPromotionRuntimeRepository,
	FullHistoryPromotionRuntimeView
} from '@history-scan-coordinator/domain/full-history-promotion/FullHistoryPromotionRuntimeRepository.js';
import type {
	ParsedLedgerHeaderRepository,
	ParsedLedgerHeaderWatermark
} from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';
import {
	readHistoricalFullHistoryBackfillStatus,
	type HistoricalFullHistoryBackfillDTO
} from './HistoricalFullHistoryBackfillStatus.js';

export interface FullHistoryStatusDTO {
	readonly canonicalCoverage: CanonicalFullHistoryCoverageDTO | null;
	readonly canonicalPromotion: CanonicalFullHistoryPromotionDTO | null;
	readonly earliestParsedLedger: string | null;
	readonly generatedAt: string;
	readonly latestObservedAt: string | null;
	readonly latestParsedLedger: string | null;
	readonly localAssetIndexReady: boolean;
	readonly localContractIndexReady: boolean;
	readonly localOperationIndexReady: boolean;
	readonly localTransactionIndexReady: boolean;
	readonly mode: 'archive_header_parser' | 'canonical_checkpoint_index';
	readonly historicalBackfill: HistoricalFullHistoryBackfillDTO | null;
	readonly parsedLedgerCount: number | null;
	readonly sourceArchiveCount: number | null;
	readonly status: StatusLevel;
}

export interface CanonicalFullHistoryPromotionDTO {
	readonly checkpointLedger: string | null;
	readonly heartbeatAt: string;
	readonly lastAttemptAt: string | null;
	readonly lastErrorCode: string | null;
	readonly lastFailureAt: string | null;
	readonly lastOutcome:
		'bootstrap-required' | 'proof-pending' | 'promoted' | 'replayed' | null;
	readonly lastSuccessAt: string | null;
	readonly nextLedger: string | null;
	readonly startedAt: string;
	readonly state:
		| 'failed'
		| 'promoting'
		| 'running'
		| 'stale'
		| 'stopped'
		| 'waiting-for-proof';
}

export interface CanonicalFullHistoryCoverageDTO {
	readonly archiveSourceCount: number;
	readonly batchCount: number;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly latestLedgerClosedAt: string;
	readonly ledgerCount: number;
	readonly nextLedger: string;
	readonly rangeKind: 'contiguous_bounded';
	readonly source: 'postgres_canonical';
	readonly transactionCount: number;
	readonly transactionResultCount: number;
	readonly updatedAt: string;
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

@injectable()
export class GetFullHistoryStatus {
	constructor(
		@inject(DataSource) private readonly dataSource: DataSource,
		@inject(HISTORY_TYPES.ParsedLedgerHeaderRepository)
		private readonly parsedLedgerHeaders: ParsedLedgerHeaderRepository,
		@inject(HISTORY_TYPES.FullHistoryCanonicalRepository)
		private readonly canonicalHistory: FullHistoryCanonicalRepository,
		@inject(HISTORY_TYPES.FullHistoryPromotionRuntimeRepository)
		private readonly canonicalPromotion: FullHistoryPromotionRuntimeRepository,
		@inject('Config') private readonly config: Config
	) {}

	async executeFullHistory(): Promise<Result<FullHistoryStatusDTO, Error>> {
		try {
			const [canonical, operationCoverage, promotion] = await Promise.all([
				this.canonicalHistory.getCoverage(
					this.config.networkConfig.networkPassphrase
				),
				this.canonicalHistory.getOperationCoverage(
					this.config.networkConfig.networkPassphrase
				),
				this.canonicalPromotion.find(
					this.config.networkConfig.networkPassphrase
				)
			]);
			if (canonical !== null) {
				const historicalBackfill =
					await readHistoricalFullHistoryBackfillStatus(
						this.dataSource,
						this.config.networkConfig.networkPassphrase
					);
				return ok(
					mapCanonicalStatus(
						canonical,
						operationCoverage,
						promotion,
						historicalBackfill
					)
				);
			}
			return ok(
				this.mapParsedHeaders(
					await this.parsedLedgerHeaders.getWatermark(),
					promotion
				)
			);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeIngestion(): Promise<Result<IngestionStatusDTO, Error>> {
		try {
			const [canonical, operationCoverage, promotion, queue] =
				await Promise.all([
					this.canonicalHistory.getCoverage(
						this.config.networkConfig.networkPassphrase
					),
					this.canonicalHistory.getOperationCoverage(
						this.config.networkConfig.networkPassphrase
					),
					this.canonicalPromotion.find(
						this.config.networkConfig.networkPassphrase
					),
					this.readQueueSummary()
				]);
			const status =
				canonical === null
					? this.mapParsedHeaders(
							await this.parsedLedgerHeaders.getWatermark(),
							promotion
						)
					: mapCanonicalStatus(
							canonical,
							operationCoverage,
							promotion,
							await readHistoricalFullHistoryBackfillStatus(
								this.dataSource,
								this.config.networkConfig.networkPassphrase
							)
						);
			return ok({ ...status, queue });
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

	async executeRanges(
		limit: number
	): Promise<Result<IndexingRangesDTO, Error>> {
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
			const ledgerSequence = Number(sequence);
			const row = Number.isSafeInteger(ledgerSequence)
				? await this.parsedLedgerHeaders.findByLedgerSequence(ledgerSequence)
				: null;
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
		const rows = await this.parsedLedgerHeaders.findSourceRanges(limit);
		return rows.map((row) => ({
			archiveUrl: row.archiveUrl,
			earliestParsedLedger: toStringValue(row.earliestLedgerSequence),
			latestObservedAt: toIso(row.latestObservedAt) ?? '',
			latestParsedLedger: toStringValue(row.latestLedgerSequence),
			parsedLedgerCount: row.parsedLedgerCount
		}));
	}

	private mapParsedHeaders(
		row: ParsedLedgerHeaderWatermark,
		promotion: FullHistoryPromotionRuntimeView | null
	): FullHistoryStatusDTO {
		const parsedLedgerCount = row.parsedLedgerCount;
		return {
			canonicalCoverage: null,
			canonicalPromotion: mapCanonicalPromotion(promotion),
			historicalBackfill: null,
			generatedAt: new Date().toISOString(),
			status: parsedLedgerCount > 0 ? 'ok' : 'unavailable',
			mode: 'archive_header_parser',
			parsedLedgerCount,
			earliestParsedLedger: toNullableString(row.earliestLedgerSequence),
			latestParsedLedger: toNullableString(row.latestLedgerSequence),
			latestObservedAt: toIso(row.latestObservedAt),
			sourceArchiveCount: row.sourceArchiveCount,
			localTransactionIndexReady: false,
			localOperationIndexReady: false,
			localAssetIndexReady: false,
			localContractIndexReady: false
		};
	}
}

function mapCanonicalStatus(
	coverage: FullHistoryCanonicalCoverageView,
	operationCoverage: FullHistoryOperationCoverage,
	promotion: FullHistoryPromotionRuntimeView | null,
	historicalBackfill: HistoricalFullHistoryBackfillDTO | null
): FullHistoryStatusDTO {
	return {
		canonicalCoverage: mapCanonicalCoverage(coverage),
		canonicalPromotion: mapCanonicalPromotion(promotion),
		earliestParsedLedger: null,
		generatedAt: new Date().toISOString(),
		historicalBackfill,
		latestObservedAt: null,
		latestParsedLedger: null,
		localAssetIndexReady: false,
		localContractIndexReady: false,
		localOperationIndexReady:
			operationCoverage.complete && operationCoverage.outcomesComplete,
		localTransactionIndexReady:
			coverage.transactionCount > 0 &&
			coverage.transactionCount === coverage.transactionResultCount,
		mode: 'canonical_checkpoint_index',
		parsedLedgerCount: null,
		sourceArchiveCount: null,
		status: 'ok'
	};
}

function mapCanonicalPromotion(
	runtime: FullHistoryPromotionRuntimeView | null
): CanonicalFullHistoryPromotionDTO | null {
	if (runtime === null) return null;
	const heartbeatAgeMs = Date.now() - runtime.heartbeatAt.valueOf();
	const state =
		heartbeatAgeMs > 120_000 &&
		runtime.state !== 'failed' &&
		runtime.state !== 'stopped'
			? 'stale'
			: runtime.state;
	return {
		checkpointLedger: runtime.checkpointLedger?.toString() ?? null,
		heartbeatAt: runtime.heartbeatAt.toISOString(),
		lastAttemptAt: runtime.lastAttemptAt?.toISOString() ?? null,
		lastErrorCode: runtime.lastErrorCode,
		lastFailureAt: runtime.lastFailureAt?.toISOString() ?? null,
		lastOutcome: runtime.lastOutcome,
		lastSuccessAt: runtime.lastSuccessAt?.toISOString() ?? null,
		nextLedger: runtime.nextLedger,
		startedAt: runtime.startedAt.toISOString(),
		state
	};
}

function mapCanonicalCoverage(
	coverage: FullHistoryCanonicalCoverageView | null
): CanonicalFullHistoryCoverageDTO | null {
	if (coverage === null) return null;
	return {
		archiveSourceCount: coverage.archiveSourceCount,
		batchCount: coverage.batchCount,
		firstLedger: coverage.firstLedger,
		lastLedger: coverage.lastLedger,
		latestLedgerClosedAt: coverage.latestLedgerClosedAt.toISOString(),
		ledgerCount: coverage.ledgerCount,
		nextLedger: coverage.nextLedger,
		rangeKind: 'contiguous_bounded',
		source: 'postgres_canonical',
		transactionCount: coverage.transactionCount,
		transactionResultCount: coverage.transactionResultCount,
		updatedAt: coverage.updatedAt.toISOString()
	};
}

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
