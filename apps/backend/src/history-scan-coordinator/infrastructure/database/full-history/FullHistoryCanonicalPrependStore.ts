import type { DataSource, EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { validateFullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import type { FullHistoryPrependReceipt } from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import {
	FullHistoryHash,
	hashNetworkPassphrase
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	assertBatchMatches,
	assertNoCompetingBatch,
	assertPrependLedgerBoundary,
	assertPrependReplayFrontier,
	assertWritablePrependFrontier,
	findBatch,
	insertBatch,
	readHistoricalFrontier,
	prependWatermark
} from './FullHistoryCanonicalBatchStore.js';
import {
	assertCanonicalBaseFacts,
	storeCanonicalBaseFacts
} from './FullHistoryCanonicalFactStore.js';

export async function prependCanonicalCheckpoint(
	dataSource: DataSource,
	input: FullHistoryCheckpointWrite
): Promise<FullHistoryPrependReceipt> {
	validateFullHistoryCheckpointWrite(input);
	const networkHash = hashNetworkPassphrase(input.networkPassphrase);

	try {
		return await dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			await lockHistoricalFrontier(manager, networkHash);
			const frontier = await readHistoricalFrontier(manager, networkHash);
			const existing = await findBatch(manager, input.batchId);
			if (existing !== null) {
				assertBatchMatches(existing, input, networkHash);
				await assertCanonicalBaseFacts(manager, input, networkHash);
				const replay = assertPrependReplayFrontier(frontier, input);
				return {
					batchId: input.batchId,
					firstLedger: replay.firstLedger,
					nextLedger: replay.nextLedger,
					replayed: true
				};
			}

			assertWritablePrependFrontier(frontier, input);
			await assertPrependLedgerBoundary(manager, input, networkHash, frontier);
			await assertNoCompetingBatch(manager, input, networkHash);
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
			const updated = await prependWatermark(
				manager,
				input,
				networkHash,
				frontier
			);
			return {
				batchId: input.batchId,
				firstLedger: updated.firstLedger,
				nextLedger: updated.nextLedger,
				replayed: false
			};
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

async function setTransactionBounds(manager: EntityManager): Promise<void> {
	await manager.query(`
		set local lock_timeout = '2s';
		set local statement_timeout = '30s'
	`);
}

async function lockHistoricalFrontier(
	manager: EntityManager,
	networkHash: FullHistoryHash
): Promise<void> {
	await manager.query(
		'select pg_advisory_xact_lock(hashtextextended($1, 178487))',
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
