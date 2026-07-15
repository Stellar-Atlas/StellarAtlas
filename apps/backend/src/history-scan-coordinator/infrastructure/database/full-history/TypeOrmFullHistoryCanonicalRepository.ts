import type { DataSource, EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import type {
	FullHistoryLedgerRangeQuery,
	FullHistoryLedgerRangeView
} from '../../../domain/full-history/FullHistoryCanonicalLedger.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import { FULL_HISTORY_RECENT_TRANSACTION_LIMIT_MAX } from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import type {
	FullHistoryCanonicalCoverageView,
	FullHistoryCanonicalRepository,
	FullHistoryLedgerView,
	FullHistoryPrependReceipt,
	FullHistoryRecentTransactionsView,
	FullHistoryTransactionView,
	FullHistoryWatermarkView,
	FullHistoryWriteReceipt
} from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import type {
	FullHistoryOperationCoverage,
	FullHistoryOperationPage,
	FullHistoryOperationQuery
} from '../../../domain/full-history/FullHistoryCanonicalOperation.js';
import {
	FullHistoryHash,
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	hashNetworkPassphrase,
	type FullHistoryLedgerSequence
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { validateFullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	advanceWatermark,
	assertBatchMatches,
	assertNoCompetingBatch,
	assertReplayWatermark,
	assertWritableWatermark,
	findBatch,
	insertBatch,
	readWatermark
} from './FullHistoryCanonicalBatchStore.js';
import { prependCanonicalCheckpoint } from './FullHistoryCanonicalPrependStore.js';
import {
	assertCanonicalBaseFacts,
	storeCanonicalBaseFacts
} from './FullHistoryCanonicalFactStore.js';
import { FullHistoryLedger } from './entities/FullHistoryLedger.js';
import { FullHistoryTransaction } from './entities/FullHistoryTransaction.js';
import { FullHistoryTransactionResult } from './entities/FullHistoryTransactionResult.js';
import { FullHistoryWatermark } from './entities/FullHistoryWatermark.js';
import {
	findCanonicalOperations,
	getCanonicalOperationCoverage
} from './FullHistoryCanonicalOperationQuery.js';
import { getCanonicalCoverage } from './FullHistoryCanonicalCoverageQuery.js';
import { findCanonicalLedgerRange } from './FullHistoryCanonicalLedgerQuery.js';

interface FullHistoryRecentTransactionRow {
	readonly closedAt: Date | string;
	readonly envelopeType: FullHistoryTransactionView['envelopeType'];
	readonly feeBid: string;
	readonly feeCharged: string;
	readonly ledgerSequence: string;
	readonly operationCount: number;
	readonly operationResultCount: number;
	readonly resultCode: number;
	readonly sourceAccount: string;
	readonly sourceAccountSequence: string;
	readonly successful: boolean;
	readonly transactionHash: Uint8Array;
	readonly transactionIndex: number;
}

interface CachedCoverage {
	readonly expiresAt: number;
	readonly pending: Promise<FullHistoryCanonicalCoverageView | null>;
}

const coverageCacheTtlMs = 10_000;

export class TypeOrmFullHistoryCanonicalRepository implements FullHistoryCanonicalRepository {
	private readonly coverageCache = new Map<string, CachedCoverage>();

	constructor(private readonly dataSource: DataSource) {}

	async findOperations(
		networkPassphrase: string,
		query: FullHistoryOperationQuery
	): Promise<FullHistoryOperationPage> {
		return findCanonicalOperations(
			this.dataSource,
			hashNetworkPassphrase(networkPassphrase),
			query
		);
	}

	async getOperationCoverage(
		networkPassphrase: string
	): Promise<FullHistoryOperationCoverage> {
		return getCanonicalOperationCoverage(
			this.dataSource,
			hashNetworkPassphrase(networkPassphrase)
		);
	}

	async prependCheckpoint(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryPrependReceipt> {
		const receipt = await prependCanonicalCheckpoint(this.dataSource, input);
		this.invalidateCoverage(input.networkPassphrase);
		return receipt;
	}

	async writeCheckpoint(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryWriteReceipt> {
		validateFullHistoryCheckpointWrite(input);
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);

		try {
			const receipt = await this.dataSource.transaction(async (manager) => {
				await setTransactionBounds(manager);
				await lockForwardFrontier(manager, networkHash);
				const watermark = await readWatermark(manager, networkHash);
				const existing = await findBatch(manager, input.batchId);
				if (existing !== null) {
					assertBatchMatches(existing, input, networkHash);
					await assertCanonicalBaseFacts(manager, input, networkHash);
					return {
						batchId: input.batchId,
						nextLedger: assertReplayWatermark(watermark, input),
						replayed: true
					};
				}

				assertWritableWatermark(watermark, input);
				await assertNoCompetingBatch(manager, input, networkHash);
				await insertBatch(manager, input, networkHash);
				await storeCanonicalBaseFacts(manager, input, networkHash);
				const nextLedger = await advanceWatermark(
					manager,
					input,
					networkHash,
					watermark
				);
				return { batchId: input.batchId, nextLedger, replayed: false };
			});
			this.invalidateCoverage(input.networkPassphrase);
			return receipt;
		} catch (error) {
			if (error instanceof FullHistoryCanonicalError) throw error;
			if (isProofConstraintError(error)) {
				throw new FullHistoryCanonicalError(
					'invalid-proof-provenance',
					'Checkpoint proof or source-object provenance is not authoritative'
				);
			}
			throw error;
		}
	}

	async getWatermark(
		networkPassphrase: string
	): Promise<FullHistoryWatermarkView | null> {
		const networkHash = hashNetworkPassphrase(networkPassphrase);
		const watermark = await this.dataSource
			.getRepository(FullHistoryWatermark)
			.findOneBy({ networkPassphraseHash: networkHash });
		return watermark === null
			? null
			: {
					lastBatchId: watermark.lastBatchId,
					nextLedger: watermark.nextLedger,
					updatedAt: new Date(watermark.updatedAt)
				};
	}

	async getCoverage(
		networkPassphrase: string
	): Promise<FullHistoryCanonicalCoverageView | null> {
		const networkHash = hashNetworkPassphrase(networkPassphrase);
		const cacheKey = networkHash.toHex();
		const cached = this.coverageCache.get(cacheKey);
		if (cached !== undefined && cached.expiresAt > Date.now()) {
			return cached.pending;
		}
		const pending = getCanonicalCoverage(this.dataSource, networkHash);
		const entry = { expiresAt: Date.now() + coverageCacheTtlMs, pending };
		this.coverageCache.set(cacheKey, entry);
		try {
			return await pending;
		} catch (error) {
			if (this.coverageCache.get(cacheKey) === entry) {
				this.coverageCache.delete(cacheKey);
			}
			throw error;
		}
	}

	private invalidateCoverage(networkPassphrase: string): void {
		this.coverageCache.delete(hashNetworkPassphrase(networkPassphrase).toHex());
	}

	async findLedger(
		networkPassphrase: string,
		ledgerSequence: FullHistoryLedgerSequence
	): Promise<FullHistoryLedgerView | null> {
		const networkPassphraseHash = hashNetworkPassphrase(networkPassphrase);
		const [ledger, operationCount] = await Promise.all([
			this.dataSource.getRepository(FullHistoryLedger).findOneBy({
				ledgerSequence,
				networkPassphraseHash
			}),
			this.dataSource
				.getRepository(FullHistoryTransaction)
				.sum('operationCount', {
					ledgerSequence,
					networkPassphraseHash
				})
		]);
		return ledger === null
			? null
			: {
					bucketListHash: ledger.bucketListHash,
					closedAt: new Date(ledger.closedAt),
					ledgerHash: ledger.ledgerHash,
					ledgerSequence: ledger.ledgerSequence,
					operationCount: operationCount ?? 0,
					previousLedgerHash: ledger.previousLedgerHash,
					protocolVersion: ledger.protocolVersion,
					transactionCount: ledger.transactionCount,
					transactionResultHash: ledger.transactionResultHash,
					transactionSetHash: ledger.transactionSetHash
				};
	}

	async findLedgerRange(
		networkPassphrase: string,
		query: FullHistoryLedgerRangeQuery
	): Promise<FullHistoryLedgerRangeView> {
		return findCanonicalLedgerRange(
			this.dataSource,
			hashNetworkPassphrase(networkPassphrase),
			query
		);
	}

	async findRecentTransactions(
		networkPassphrase: string,
		limit: number
	): Promise<FullHistoryRecentTransactionsView> {
		assertRecentTransactionLimit(limit);
		const networkHash = hashNetworkPassphrase(networkPassphrase);
		const rows = await this.dataSource.query<FullHistoryRecentTransactionRow[]>(
			`
				with recent_transaction as materialized (
					select
						tx."network_passphrase_hash",
						tx."transaction_hash",
						tx."ledger_sequence",
						tx."transaction_index",
						tx."envelope_type",
						tx."source_account",
						tx."source_account_sequence",
						tx."fee_bid",
						tx."operation_count"
					from "full_history_transaction" tx
					where tx."network_passphrase_hash" = $1
					order by
						tx."ledger_sequence" desc,
						tx."transaction_index" desc
					limit $2
				)
				select
					ledger."closed_at" as "closedAt",
					tx."envelope_type" as "envelopeType",
					tx."fee_bid"::text as "feeBid",
					result."fee_charged"::text as "feeCharged",
					tx."ledger_sequence"::text as "ledgerSequence",
					tx."operation_count" as "operationCount",
					result."operation_result_count" as "operationResultCount",
					result."result_code" as "resultCode",
					tx."source_account" as "sourceAccount",
					tx."source_account_sequence"::text as "sourceAccountSequence",
					result."successful" as "successful",
					tx."transaction_hash" as "transactionHash",
					tx."transaction_index" as "transactionIndex"
				from recent_transaction tx
				join "full_history_transaction_result" result
					on result."network_passphrase_hash" =
						tx."network_passphrase_hash"
					and result."ledger_sequence" = tx."ledger_sequence"
					and result."transaction_index" = tx."transaction_index"
					and result."transaction_hash" = tx."transaction_hash"
				join "full_history_ledger" ledger
					on ledger."network_passphrase_hash" =
						tx."network_passphrase_hash"
					and ledger."ledger_sequence" = tx."ledger_sequence"
				order by tx."ledger_sequence" desc, tx."transaction_index" desc
			`,
			[networkHash.toBuffer(), limit + 1]
		);
		const truncated = rows.length > limit;

		return {
			records: rows.slice(0, limit).map(mapRecentTransaction),
			truncated
		};
	}

	async findTransaction(
		networkPassphrase: string,
		transactionHash: FullHistoryHash
	): Promise<FullHistoryTransactionView | null> {
		const networkPassphraseHash = hashNetworkPassphrase(networkPassphrase);
		const transaction = await this.dataSource
			.getRepository(FullHistoryTransaction)
			.findOneBy({ networkPassphraseHash, transactionHash });
		if (transaction === null) return null;
		const [ledger, result] = await Promise.all([
			this.dataSource.getRepository(FullHistoryLedger).findOneBy({
				ledgerSequence: transaction.ledgerSequence,
				networkPassphraseHash
			}),
			this.dataSource
				.getRepository(FullHistoryTransactionResult)
				.findOneBy({ networkPassphraseHash, transactionHash })
		]);
		if (result === null) {
			throw new FullHistoryCanonicalError(
				'canonical-row-conflict',
				'Canonical transaction is missing its result'
			);
		}
		if (ledger === null) {
			throw new FullHistoryCanonicalError(
				'canonical-row-conflict',
				'Canonical transaction is missing its ledger'
			);
		}
		return {
			closedAt: new Date(ledger.closedAt),
			envelopeType: transaction.envelopeType,
			feeBid: transaction.feeBid,
			feeCharged: result.feeCharged,
			ledgerSequence: transaction.ledgerSequence,
			operationCount: transaction.operationCount,
			operationResultCount: result.operationResultCount,
			resultCode: result.resultCode,
			sourceAccount: transaction.sourceAccount,
			sourceAccountSequence: transaction.sourceAccountSequence,
			successful: result.successful,
			transactionHash: transaction.transactionHash,
			transactionIndex: transaction.transactionIndex
		};
	}
}

function assertRecentTransactionLimit(limit: number): void {
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > FULL_HISTORY_RECENT_TRANSACTION_LIMIT_MAX
	) {
		throw new RangeError(
			`limit must be an integer between 1 and ${FULL_HISTORY_RECENT_TRANSACTION_LIMIT_MAX}`
		);
	}
}

function mapRecentTransaction(
	row: FullHistoryRecentTransactionRow
): FullHistoryTransactionView {
	return {
		closedAt: toDate(row.closedAt),
		envelopeType: row.envelopeType,
		feeBid: fullHistoryUint64(row.feeBid, 'feeBid'),
		feeCharged: fullHistoryUint64(row.feeCharged, 'feeCharged'),
		ledgerSequence: fullHistoryLedgerSequence(
			row.ledgerSequence,
			'ledgerSequence'
		),
		operationCount: row.operationCount,
		operationResultCount: row.operationResultCount,
		resultCode: row.resultCode,
		sourceAccount: row.sourceAccount,
		sourceAccountSequence: fullHistoryUint64(
			row.sourceAccountSequence,
			'sourceAccountSequence'
		),
		successful: row.successful,
		transactionHash: FullHistoryHash.fromBytes(row.transactionHash),
		transactionIndex: row.transactionIndex
	};
}

function toDate(value: Date | string): Date {
	const date =
		value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new TypeError(
			'PostgreSQL returned an invalid full-history timestamp'
		);
	}
	return date;
}

async function setTransactionBounds(manager: EntityManager): Promise<void> {
	await manager.query(`
		set local lock_timeout = '2s';
		set local statement_timeout = '30s'
	`);
}

async function lockForwardFrontier(
	manager: EntityManager,
	networkHash: FullHistoryHash
): Promise<void> {
	await manager.query(
		'select pg_advisory_xact_lock(hashtextextended($1, 178486))',
		[networkHash.toHex()]
	);
}

function isProofConstraintError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const candidate = error as {
		readonly code?: unknown;
		readonly driverError?: {
			readonly code?: unknown;
			readonly message?: unknown;
		};
		readonly message?: unknown;
	};
	const code = candidate.driverError?.code ?? candidate.code;
	const message = candidate.driverError?.message ?? candidate.message;
	return (
		code === '23514' &&
		typeof message === 'string' &&
		message.includes('full-history batch')
	);
}
