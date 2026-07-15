import type { FullHistoryCheckpointWrite } from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	assertOperationBackfillCandidateProvenance,
	validateFullHistoryOperationBackfillCpuWorkerCount,
	validateFullHistoryOperationBackfillDatabaseWorkerCount,
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
	readonly cpuWorkerCount: number;
	readonly databaseWorkerCount: number;
	readonly networkPassphrase: string;
}

export interface BackfillFullHistoryOperationsResult {
	readonly accountReferenceFacts: number;
	readonly batchLimit: number;
	readonly completedBatches: number;
	readonly cpuWorkers: number;
	readonly databaseWorkers: number;
	readonly operationFacts: number;
	readonly peakActiveBatches: number;
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
		validateFullHistoryOperationBackfillCpuWorkerCount(input.cpuWorkerCount);
		validateFullHistoryOperationBackfillDatabaseWorkerCount(
			input.databaseWorkerCount
		);
		const batches = await this.backfillRepository.findUnindexedBatches(
			input.networkPassphrase,
			input.batchLimit
		);
		const execution = await this.backfillBatches(
			batches,
			input.networkPassphrase,
			input.cpuWorkerCount,
			input.databaseWorkerCount
		);
		const receipts = execution.receipts;
		return {
			accountReferenceFacts: receipts.reduce(
				(total, receipt) => total + receipt.accountReferenceCount,
				0
			),
			batchLimit: input.batchLimit,
			completedBatches: receipts.length,
			cpuWorkers: input.cpuWorkerCount,
			databaseWorkers: input.databaseWorkerCount,
			operationFacts: receipts.reduce(
				(total, receipt) => total + receipt.operationCount,
				0
			),
			peakActiveBatches: execution.peakActiveBatches,
			receipts,
			selectedBatches: batches.length,
			status: batches.length === 0 ? 'idle' : 'completed'
		};
	}

	private async backfillBatches(
		batches: readonly FullHistoryOperationBackfillBatch[],
		networkPassphrase: string,
		cpuWorkerCount: number,
		databaseWorkerCount: number
	): Promise<{
		readonly peakActiveBatches: number;
		readonly receipts: readonly FullHistoryOperationBackfillReceipt[];
	}> {
		const receipts = new Map<number, FullHistoryOperationBackfillReceipt>();
		let activeBatches = 0;
		let nextBatchIndex = 0;
		let peakActiveBatches = 0;
		const databaseGate = new AsyncConcurrencyGate(databaseWorkerCount);
		let firstFailure: { readonly error: unknown } | undefined;

		const runSlot = async (): Promise<void> => {
			while (firstFailure === undefined) {
				const batchIndex = nextBatchIndex;
				const batch = batches[batchIndex];
				if (batch === undefined) return;
				nextBatchIndex += 1;
				activeBatches += 1;
				peakActiveBatches = Math.max(peakActiveBatches, activeBatches);
				try {
					receipts.set(
						batchIndex,
						await this.backfillBatch(batch, networkPassphrase, databaseGate)
					);
				} catch (error) {
					firstFailure ??= { error };
				} finally {
					activeBatches -= 1;
				}
			}
		};

		await Promise.all(
			Array.from({ length: Math.min(cpuWorkerCount, batches.length) }, runSlot)
		);
		if (firstFailure !== undefined) throw firstFailure.error;
		return {
			peakActiveBatches,
			receipts: [...receipts.entries()]
				.toSorted(([left], [right]) => left - right)
				.map(([, receipt]) => receipt)
		};
	}

	private async backfillBatch(
		batch: FullHistoryOperationBackfillBatch,
		networkPassphrase: string,
		databaseGate: AsyncConcurrencyGate
	): Promise<FullHistoryOperationBackfillReceipt> {
		const candidate = await databaseGate.run(() =>
			this.candidateRepository.load({
				archiveUrlIdentity: batch.archiveUrlIdentity,
				checkpointLedger: Number(batch.checkpointLedger),
				networkPassphrase
			})
		);
		assertOperationBackfillCandidateProvenance(
			batch,
			candidate,
			networkPassphrase
		);
		const sources = candidate.proof.sources;
		const decoded = await this.decoder.decode(candidate, networkPassphrase);
		return databaseGate.run(() =>
			this.backfillRepository.storeOperations(
				composeCheckpointWrite(
					batch,
					sources,
					decoded,
					networkPassphrase,
					this.decoder
				)
			)
		);
	}
}

class AsyncConcurrencyGate {
	private active = 0;
	private readonly waiters: Array<() => void> = [];

	constructor(private readonly capacity: number) {}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await operation();
		} finally {
			this.release();
		}
	}

	private async acquire(): Promise<void> {
		if (this.active < this.capacity) {
			this.active += 1;
			return;
		}
		await new Promise<void>((resolve) => this.waiters.push(resolve));
	}

	private release(): void {
		const next = this.waiters.shift();
		if (next !== undefined) {
			next();
			return;
		}
		this.active -= 1;
	}
}

function composeCheckpointWrite(
	batch: FullHistoryOperationBackfillBatch,
	sources: FullHistoryCheckpointWrite['sources'],
	decoded: Awaited<ReturnType<FullHistoryCheckpointDecoder['decode']>>,
	networkPassphrase: string,
	decoder: FullHistoryCheckpointDecoder
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
		operationAccountReferenceDecoderVersion:
			decoder.operationAccountReferenceDecoderVersion,
		operationAccountReferences: decoded.operationAccountReferences,
		operationDecoderVersion: decoder.operationDecoderVersion,
		operations: decoded.operations,
		operationResultDecoderVersion: decoder.operationResultDecoderVersion,
		operationResults: decoded.operationResults,
		proofEvaluatedAt: batch.proofEvaluatedAt,
		proofId: batch.proofId,
		proofVersion: batch.proofVersion,
		results: decoded.results,
		sources,
		transactions: decoded.transactions
	};
}
