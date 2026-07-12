import type { DataSource, EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import type {
	FullHistoryCanonicalRepository,
	FullHistoryLedgerView,
	FullHistoryTransactionView,
	FullHistoryWatermarkView,
	FullHistoryWriteReceipt
} from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import {
	FullHistoryHash,
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
	lockWatermark
} from './FullHistoryCanonicalBatchStore.js';
import {
	assertCanonicalFacts,
	storeCanonicalFacts
} from './FullHistoryCanonicalFactStore.js';
import { FullHistoryLedger } from './entities/FullHistoryLedger.js';
import { FullHistoryTransaction } from './entities/FullHistoryTransaction.js';
import { FullHistoryTransactionResult } from './entities/FullHistoryTransactionResult.js';
import { FullHistoryWatermark } from './entities/FullHistoryWatermark.js';

export class TypeOrmFullHistoryCanonicalRepository implements FullHistoryCanonicalRepository {
	constructor(private readonly dataSource: DataSource) {}

	async writeCheckpoint(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryWriteReceipt> {
		validateFullHistoryCheckpointWrite(input);
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);

		try {
			return await this.dataSource.transaction(async (manager) => {
				await setTransactionBounds(manager);
				await lockNetwork(manager, networkHash);
				const watermark = await lockWatermark(manager, networkHash);
				const existing = await findBatch(manager, input.batchId);
				if (existing !== null) {
					assertBatchMatches(existing, input, networkHash);
					await assertCanonicalFacts(manager, input, networkHash);
					return {
						batchId: input.batchId,
						nextLedger: assertReplayWatermark(watermark, input),
						replayed: true
					};
				}

				assertWritableWatermark(watermark, input);
				await assertNoCompetingBatch(manager, input, networkHash);
				await insertBatch(manager, input, networkHash);
				await storeCanonicalFacts(manager, input, networkHash);
				const nextLedger = await advanceWatermark(
					manager,
					input,
					networkHash,
					watermark
				);
				return { batchId: input.batchId, nextLedger, replayed: false };
			});
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

	async findLedger(
		networkPassphrase: string,
		ledgerSequence: FullHistoryLedgerSequence
	): Promise<FullHistoryLedgerView | null> {
		const ledger = await this.dataSource
			.getRepository(FullHistoryLedger)
			.findOneBy({
				ledgerSequence,
				networkPassphraseHash: hashNetworkPassphrase(networkPassphrase)
			});
		return ledger === null
			? null
			: {
					bucketListHash: ledger.bucketListHash,
					closedAt: new Date(ledger.closedAt),
					ledgerHash: ledger.ledgerHash,
					ledgerSequence: ledger.ledgerSequence,
					previousLedgerHash: ledger.previousLedgerHash,
					protocolVersion: ledger.protocolVersion,
					transactionCount: ledger.transactionCount,
					transactionResultHash: ledger.transactionResultHash,
					transactionSetHash: ledger.transactionSetHash
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
		const result = await this.dataSource
			.getRepository(FullHistoryTransactionResult)
			.findOneBy({ networkPassphraseHash, transactionHash });
		if (result === null) {
			throw new FullHistoryCanonicalError(
				'canonical-row-conflict',
				'Canonical transaction is missing its result'
			);
		}
		return {
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

async function setTransactionBounds(manager: EntityManager): Promise<void> {
	await manager.query(`
		set local lock_timeout = '2s';
		set local statement_timeout = '30s'
	`);
}

async function lockNetwork(
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
