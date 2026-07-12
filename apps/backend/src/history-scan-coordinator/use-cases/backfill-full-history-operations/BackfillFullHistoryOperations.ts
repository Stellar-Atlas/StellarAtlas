import type { FullHistoryCheckpointWrite } from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	assertOperationBackfillCandidateProvenance,
	validateFullHistoryOperationBackfillLimit,
	type FullHistoryOperationBackfillBatch
} from '../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import type {
	FullHistoryOperationBackfillReceipt,
	FullHistoryOperationBackfillRepository
} from '../../domain/full-history-operation-backfill/FullHistoryOperationBackfillRepository.js';
import type { FullHistoryCheckpointCandidateRepository } from '../../domain/full-history-promotion/FullHistoryCheckpointCandidateRepository.js';
import type { FullHistoryCheckpointDecoder } from '../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';

export interface BackfillFullHistoryOperationsInput {
	readonly batchLimit: number;
	readonly networkPassphrase: string;
}

export interface BackfillFullHistoryOperationsResult {
	readonly batchLimit: number;
	readonly completedBatches: number;
	readonly operationFacts: number;
	readonly receipts: readonly FullHistoryOperationBackfillReceipt[];
	readonly selectedBatches: number;
	readonly status: 'completed' | 'idle';
}

export class BackfillFullHistoryOperations {
	constructor(
		private readonly backfillRepository: FullHistoryOperationBackfillRepository,
		private readonly candidateRepository: FullHistoryCheckpointCandidateRepository,
		private readonly decoder: FullHistoryCheckpointDecoder
	) {}

	async execute(
		input: BackfillFullHistoryOperationsInput
	): Promise<BackfillFullHistoryOperationsResult> {
		validateFullHistoryOperationBackfillLimit(input.batchLimit);
		const batches = await this.backfillRepository.findUnindexedBatches(
			input.networkPassphrase,
			input.batchLimit
		);
		const receipts: FullHistoryOperationBackfillReceipt[] = [];
		for (const batch of batches) {
			receipts.push(await this.backfillBatch(batch, input.networkPassphrase));
		}
		return {
			batchLimit: input.batchLimit,
			completedBatches: receipts.length,
			operationFacts: receipts.reduce(
				(total, receipt) => total + receipt.operationCount,
				0
			),
			receipts,
			selectedBatches: batches.length,
			status: batches.length === 0 ? 'idle' : 'completed'
		};
	}

	private async backfillBatch(
		batch: FullHistoryOperationBackfillBatch,
		networkPassphrase: string
	): Promise<FullHistoryOperationBackfillReceipt> {
		const candidate = await this.candidateRepository.load({
			archiveUrlIdentity: batch.archiveUrlIdentity,
			checkpointLedger: Number(batch.checkpointLedger),
			networkPassphrase
		});
		assertOperationBackfillCandidateProvenance(
			batch,
			candidate,
			networkPassphrase
		);
		const decoded = await this.decoder.decode(candidate, networkPassphrase);
		return this.backfillRepository.storeOperations(
			composeCheckpointWrite(
				batch,
				candidate.proof.sources,
				decoded,
				networkPassphrase
			),
			this.decoder.version
		);
	}
}

function composeCheckpointWrite(
	batch: FullHistoryOperationBackfillBatch,
	sources: FullHistoryCheckpointWrite['sources'],
	decoded: Awaited<ReturnType<FullHistoryCheckpointDecoder['decode']>>,
	networkPassphrase: string
): FullHistoryCheckpointWrite {
	return {
		archiveUrlIdentity: batch.archiveUrlIdentity,
		batchId: batch.batchId,
		checkpointLedger: batch.checkpointLedger,
		decoderVersion: batch.canonicalDecoderVersion,
		firstLedger: batch.firstLedger,
		lastLedger: batch.lastLedger,
		ledgers: decoded.ledgers,
		networkPassphrase,
		operations: decoded.operations,
		proofEvaluatedAt: batch.proofEvaluatedAt,
		proofId: batch.proofId,
		proofVersion: batch.proofVersion,
		results: decoded.results,
		sources,
		transactions: decoded.transactions
	};
}
