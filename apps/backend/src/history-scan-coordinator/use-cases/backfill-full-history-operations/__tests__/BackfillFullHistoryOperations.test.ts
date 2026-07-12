import type { FullHistoryOperationBackfillBatch } from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import type {
	FullHistoryOperationBackfillReceipt,
	FullHistoryOperationBackfillRepository
} from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfillRepository.js';
import type {
	FullHistoryCheckpointCandidate,
	FullHistoryPromotionTarget
} from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type { FullHistoryCheckpointCandidateRepository } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidateRepository.js';
import type {
	FullHistoryCheckpointDecoder,
	FullHistoryDecodedCheckpoint
} from '../../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { BackfillFullHistoryOperations } from '../BackfillFullHistoryOperations.js';

const networkPassphrase = 'Operation scheduler fixture network';
const emptyDecoded: FullHistoryDecodedCheckpoint = {
	ledgers: [],
	operations: [],
	operationResults: [],
	results: [],
	transactions: []
};

describe('BackfillFullHistoryOperations bounded scheduler', () => {
	it('never loads or decodes more batches than the total CPU worker cap', async () => {
		const batches = createBatches(4);
		const candidates = new CandidateFixtureRepository(batches);
		const decoder = new GatedDecoder();
		const repository = new ResumableBackfillRepository(batches);
		const execution = new BackfillFullHistoryOperations(
			repository,
			candidates,
			decoder
		).execute(runInput(4, 2));

		await waitFor(() => decoder.started.length === 2);
		expect(decoder.peakActive).toBe(2);
		expect(candidates.loaded).toHaveLength(2);
		decoder.release();

		await expect(execution).resolves.toMatchObject({
			completedBatches: 4,
			cpuWorkers: 2,
			peakActiveBatches: 2,
			selectedBatches: 4,
			status: 'completed'
		});
		expect(decoder.peakActive).toBe(2);
		expect(repository.covered.size).toBe(4);
	});

	it('drains active work after a statement timeout, stops admission, and resumes uncovered batches without an automatic retry', async () => {
		const batches = createBatches(3);
		const candidates = new CandidateFixtureRepository(batches);
		const secondBatchGate = deferred<void>();
		const decoder = new SelectiveDecoder(
			batches[1]!.checkpointLedger,
			secondBatchGate.promise
		);
		const repository = new ResumableBackfillRepository(
			batches,
			batches[0]!.batchId
		);
		const useCase = new BackfillFullHistoryOperations(
			repository,
			candidates,
			decoder
		);
		let settled = false;
		const firstExecution = useCase.execute(runInput(3, 2));
		void firstExecution.then(
			() => {
				settled = true;
			},
			() => {
				settled = true;
			}
		);

		await waitFor(() => repository.attempts(batches[0]!.batchId) === 1);
		expect(candidates.loaded).toEqual([
			Number(batches[0]!.checkpointLedger),
			Number(batches[1]!.checkpointLedger)
		]);
		expect(settled).toBe(false);
		secondBatchGate.resolve();

		await expect(firstExecution).rejects.toThrow(
			'canceling statement due to statement timeout'
		);
		expect(repository.covered).toEqual(new Set([batches[1]!.batchId]));
		expect(repository.attempts(batches[0]!.batchId)).toBe(1);
		expect(candidates.loaded).not.toContain(
			Number(batches[2]!.checkpointLedger)
		);

		await expect(useCase.execute(runInput(3, 2))).resolves.toMatchObject({
			completedBatches: 2,
			operationFacts: 0,
			selectedBatches: 2,
			status: 'completed'
		});
		expect(repository.attempts(batches[0]!.batchId)).toBe(2);
		expect(repository.covered.size).toBe(3);
	});

	it('does not swallow a non-Error rejection while stopping admission', async () => {
		const batches = createBatches(2);
		const candidates = new CandidateFixtureRepository(batches);
		const repository = new ResumableBackfillRepository(batches);
		const rejectingRepository: FullHistoryOperationBackfillRepository = {
			findUnindexedBatches: (requestedNetwork, limit) =>
				repository.findUnindexedBatches(requestedNetwork, limit),
			storeOperations: () => Promise.reject(undefined)
		};

		await expect(
			new BackfillFullHistoryOperations(
				rejectingRepository,
				candidates,
				new SelectiveDecoder('', Promise.resolve())
			).execute(runInput(2, 1))
		).rejects.toBeUndefined();
		expect(candidates.loaded).toHaveLength(1);
	});
});

class CandidateFixtureRepository implements FullHistoryCheckpointCandidateRepository {
	readonly loaded: number[] = [];
	private readonly byCheckpoint: ReadonlyMap<
		number,
		FullHistoryCheckpointCandidate
	>;

	constructor(batches: readonly FullHistoryOperationBackfillBatch[]) {
		this.byCheckpoint = new Map(
			batches.map((batch) => [
				Number(batch.checkpointLedger),
				candidateForBatch(batch)
			])
		);
	}

	async load(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryCheckpointCandidate> {
		this.loaded.push(target.checkpointLedger);
		const candidate = this.byCheckpoint.get(target.checkpointLedger);
		if (candidate === undefined) throw new Error('Missing fixture candidate');
		return candidate;
	}
}

class GatedDecoder implements FullHistoryCheckpointDecoder {
	readonly operationDecoderVersion = 'worker-operation-test-v1';
	readonly operationResultDecoderVersion = 'worker-result-test-v1';
	readonly version = 'worker-test-v1';
	readonly started: number[] = [];
	peakActive = 0;
	private active = 0;
	private readonly gate = deferred<void>();

	async decode(
		candidate: FullHistoryCheckpointCandidate
	): Promise<FullHistoryDecodedCheckpoint> {
		this.started.push(Number(candidate.proof.checkpointLedger));
		this.active += 1;
		this.peakActive = Math.max(this.peakActive, this.active);
		await this.gate.promise;
		this.active -= 1;
		return emptyDecoded;
	}

	release(): void {
		this.gate.resolve();
	}
}

class SelectiveDecoder implements FullHistoryCheckpointDecoder {
	readonly operationDecoderVersion = 'worker-operation-test-v1';
	readonly operationResultDecoderVersion = 'worker-result-test-v1';
	readonly version = 'worker-test-v1';

	constructor(
		private readonly blockedCheckpoint: string,
		private readonly gate: Promise<void>
	) {}

	async decode(
		candidate: FullHistoryCheckpointCandidate
	): Promise<FullHistoryDecodedCheckpoint> {
		if (candidate.proof.checkpointLedger === this.blockedCheckpoint) {
			await this.gate;
		}
		return emptyDecoded;
	}
}

class ResumableBackfillRepository implements FullHistoryOperationBackfillRepository {
	readonly covered = new Set<string>();
	private readonly attemptCounts = new Map<string, number>();
	private timeoutPending: boolean;

	constructor(
		private readonly batches: readonly FullHistoryOperationBackfillBatch[],
		private readonly timeoutBatchId?: string
	) {
		this.timeoutPending = timeoutBatchId !== undefined;
	}

	async findUnindexedBatches(
		_networkPassphrase: string,
		limit: number
	): Promise<readonly FullHistoryOperationBackfillBatch[]> {
		return this.batches
			.filter((batch) => !this.covered.has(batch.batchId))
			.slice(0, limit);
	}

	async storeOperations(input: {
		readonly batchId: string;
		readonly operations: readonly unknown[];
	}): Promise<FullHistoryOperationBackfillReceipt> {
		this.attemptCounts.set(
			input.batchId,
			(this.attemptCounts.get(input.batchId) ?? 0) + 1
		);
		if (this.timeoutPending && input.batchId === this.timeoutBatchId) {
			this.timeoutPending = false;
			throw new Error('canceling statement due to statement timeout');
		}
		const replayed = this.covered.has(input.batchId);
		this.covered.add(input.batchId);
		return {
			batchId: input.batchId,
			operationCount: input.operations.length,
			replayed
		};
	}

	attempts(batchId: string): number {
		return this.attemptCounts.get(batchId) ?? 0;
	}
}

function createBatches(count: number): FullHistoryOperationBackfillBatch[] {
	return Array.from({ length: count }, (_, index) => {
		const checkpointLedger = fullHistoryLedgerSequence(BigInt(63 + index * 64));
		const sources = {
			checkpointState: source(index * 4 + 1),
			ledger: source(index * 4 + 2),
			results: source(index * 4 + 3),
			transactions: source(index * 4 + 4)
		};
		return {
			archiveUrlIdentity: 'https://archive.example',
			batchId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
			canonicalDecoderVersion: 'canonical-v1',
			checkpointLedger,
			firstLedger: fullHistoryLedgerSequence(
				index === 0 ? 1n : BigInt(checkpointLedger) - 63n
			),
			lastLedger: checkpointLedger,
			proofEvaluatedAt: new Date('2026-07-12T00:00:00.000Z'),
			proofId: index + 1,
			proofVersion: 1,
			sources
		};
	});
}

function candidateForBatch(
	batch: FullHistoryOperationBackfillBatch
): FullHistoryCheckpointCandidate {
	return {
		envelopes: [],
		ledgers: [],
		proof: {
			archiveUrlIdentity: batch.archiveUrlIdentity,
			checkpointLedger: batch.checkpointLedger,
			evaluatedAt: batch.proofEvaluatedAt,
			id: batch.proofId,
			networkPassphrase,
			sources: batch.sources,
			version: batch.proofVersion
		},
		results: []
	};
}

function source(seed: number) {
	return {
		contentDigest: FullHistoryHash.fromHex(seed.toString(16).padStart(64, '0')),
		remoteId: `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`
	};
}

function runInput(batchLimit: number, cpuWorkerCount: number) {
	return { batchLimit, cpuWorkerCount, networkPassphrase };
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolvePromise: ((value: T) => void) | undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return {
		promise,
		resolve: (value) => {
			if (resolvePromise === undefined)
				throw new Error('Deferred is unavailable');
			resolvePromise(value);
		}
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	throw new Error('Timed out waiting for fixture state');
}
