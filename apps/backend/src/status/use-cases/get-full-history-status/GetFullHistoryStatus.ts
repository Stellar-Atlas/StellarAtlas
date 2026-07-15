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
import {
	readHistoricalFullHistoryBackfillStatus,
	type HistoricalFullHistoryBackfillDTO
} from './HistoricalFullHistoryBackfillStatus.js';
import {
	readFullHistoryLedgerCloseMetaCoverage,
	type FullHistoryLedgerCloseMetaCoverageDTO
} from './FullHistoryLedgerCloseMetaCoverage.js';
import { mapCanonicalCoverage } from '@history-scan-coordinator/use-cases/get-full-history-canonical-coverage/FullHistoryCanonicalCoverageDTO.js';
import {
	readFullHistoryLedgerCloseMetaStateStatus,
	type FullHistoryLedgerCloseMetaStateStatusDTO
} from './FullHistoryLedgerCloseMetaStateStatus.js';
import type {
	CanonicalFullHistoryPromotionDTO,
	FullHistoryStatusDTO,
	IndexingJobDTO,
	IndexingJobsDTO,
	IndexingRangeDTO,
	IndexingRangesDTO,
	IngestionStatusDTO,
	LedgerIngestionStatusDTO
} from './FullHistoryStatusDTO.js';

export type {
	CanonicalFullHistoryCoverageDTO,
	CanonicalFullHistoryPromotionDTO,
	FullHistoryStatusDTO,
	IndexingJobDTO,
	IndexingJobsDTO,
	IndexingRangeDTO,
	IndexingRangesDTO,
	IngestionStatusDTO,
	LedgerIngestionStatusDTO
} from './FullHistoryStatusDTO.js';

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
			const [
				canonical,
				operationCoverage,
				promotion,
				ledgerCloseMeta,
				ledgerCloseMetaState
			] = await Promise.all([
				this.canonicalHistory.getCoverage(
					this.config.networkConfig.networkPassphrase
				),
				this.canonicalHistory.getOperationCoverage(
					this.config.networkConfig.networkPassphrase
				),
				this.canonicalPromotion.find(
					this.config.networkConfig.networkPassphrase
				),
				readFullHistoryLedgerCloseMetaCoverage(
					this.dataSource,
					this.config.networkConfig.networkPassphrase
				),
				readFullHistoryLedgerCloseMetaStateStatus(
					this.dataSource,
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
						historicalBackfill,
						ledgerCloseMeta,
						ledgerCloseMetaState
					)
				);
			}
			return ok(
				this.mapParsedHeaders(
					await this.parsedLedgerHeaders.getWatermark(),
					promotion,
					ledgerCloseMeta,
					ledgerCloseMetaState
				)
			);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeIngestion(): Promise<Result<IngestionStatusDTO, Error>> {
		try {
			const [
				canonical,
				operationCoverage,
				promotion,
				queue,
				ledgerCloseMeta,
				ledgerCloseMetaState
			] = await Promise.all([
				this.canonicalHistory.getCoverage(
					this.config.networkConfig.networkPassphrase
				),
				this.canonicalHistory.getOperationCoverage(
					this.config.networkConfig.networkPassphrase
				),
				this.canonicalPromotion.find(
					this.config.networkConfig.networkPassphrase
				),
				this.readQueueSummary(),
				readFullHistoryLedgerCloseMetaCoverage(
					this.dataSource,
					this.config.networkConfig.networkPassphrase
				),
				readFullHistoryLedgerCloseMetaStateStatus(
					this.dataSource,
					this.config.networkConfig.networkPassphrase
				)
			]);
			const status =
				canonical === null
					? this.mapParsedHeaders(
							await this.parsedLedgerHeaders.getWatermark(),
							promotion,
							ledgerCloseMeta,
							ledgerCloseMetaState
						)
					: mapCanonicalStatus(
							canonical,
							operationCoverage,
							promotion,
							await readHistoricalFullHistoryBackfillStatus(
								this.dataSource,
								this.config.networkConfig.networkPassphrase
							),
							ledgerCloseMeta,
							ledgerCloseMetaState
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
		promotion: FullHistoryPromotionRuntimeView | null,
		ledgerCloseMeta: FullHistoryLedgerCloseMetaCoverageDTO | null,
		ledgerCloseMetaState: FullHistoryLedgerCloseMetaStateStatusDTO
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
			ledgerCloseMeta,
			ledgerCloseMetaState,
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
	historicalBackfill: HistoricalFullHistoryBackfillDTO | null,
	ledgerCloseMeta: FullHistoryLedgerCloseMetaCoverageDTO | null,
	ledgerCloseMetaState: FullHistoryLedgerCloseMetaStateStatusDTO
): FullHistoryStatusDTO {
	return {
		canonicalCoverage: mapCanonicalCoverage(coverage),
		canonicalPromotion: mapCanonicalPromotion(promotion),
		earliestParsedLedger: null,
		generatedAt: new Date().toISOString(),
		historicalBackfill,
		latestObservedAt: null,
		latestParsedLedger: null,
		ledgerCloseMeta,
		ledgerCloseMetaState,
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
