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
	lockHistoricalFrontier,
	prependWatermark
} from './FullHistoryCanonicalBatchStore.js';
import {
	assertCanonicalFacts,
	storeCanonicalFacts
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
			await lockNetwork(manager, networkHash);
			const frontier = await lockHistoricalFrontier(manager, networkHash);
			const existing = await findBatch(manager, input.batchId);
			if (existing !== null) {
				assertBatchMatches(existing, input, networkHash);
				await assertCanonicalFacts(manager, input, networkHash);
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
			await storeCanonicalFacts(manager, input, networkHash);
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
