import {
	assertOperationBackfillCandidateProvenance,
	type FullHistoryOperationBackfillBatch
} from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
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
	operationAccountReferences: [],
	operations: [],
	operationResults: [],
	results: [],
	transactions: []
};

describe('BackfillFullHistoryOperations bounded scheduler', () => {
	it('accepts a re-evaluated proof timestamp when immutable proof and source identities still match', () => {
		const batch = createBatches(1)[0]!;
		const candidate = candidateForBatch(batch);
		const reevaluatedCandidate = {
			...candidate,
			proof: {
				...candidate.proof,
				evaluatedAt: new Date(candidate.proof.evaluatedAt.getTime() + 60_000)
			}
		};

		expect(() =>
			assertOperationBackfillCandidateProvenance(
				batch,
				reevaluatedCandidate,
				networkPassphrase
			)
		).not.toThrow();
	});

	it('accepts a stronger proof over the same immutable source objects', () => {
		const batch = { ...createBatches(1)[0]!, proofVersion: 5 };
		const candidate = candidateForBatch(batch);

		expect(() =>
			assertOperationBackfillCandidateProvenance(
				batch,
				{
					...candidate,
					proof: { ...candidate.proof, version: 6 }
				},
				networkPassphrase
			)
		).not.toThrow();
	});

	it('rejects an unrecognized proof-version upgrade', () => {
		const batch = { ...createBatches(1)[0]!, proofVersion: 5 };
		const candidate = candidateForBatch(batch);

		expect(() =>
			assertOperationBackfillCandidateProvenance(
				batch,
				{
					...candidate,
					proof: { ...candidate.proof, version: 7 }
				},
				networkPassphrase
			)
		).toThrow('immutable canonical provenance');
	});

	it('rejects a proof older than the immutable batch provenance', () => {
		const batch = { ...createBatches(1)[0]!, proofVersion: 2 };
		const candidate = candidateForBatch(batch);

		expect(() =>
			assertOperationBackfillCandidateProvenance(
				batch,
				{
					...candidate,
					proof: { ...candidate.proof, version: 1 }
				},
				networkPassphrase
			)
		).toThrow('immutable canonical provenance');
	});

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

	it('bounds database reads independently while filling the CPU worker pool', async () => {
		const batches = createBatches(4);
		const candidateGate = deferred<void>();
		const candidates = new CandidateFixtureRepository(
			batches,
			candidateGate.promise
		);
		const decoder = new GatedDecoder();
		const repository = new ResumableBackfillRepository(batches);
		const execution = new BackfillFullHistoryOperations(
			repository,
			candidates,
			decoder
		).execute({
			batchLimit: 4,
			cpuWorkerCount: 4,
			databaseWorkerCount: 2,
			networkPassphrase
		});

		await waitFor(() => candidates.peakActive === 2);
		expect(candidates.loaded).toHaveLength(2);
		candidateGate.resolve();
		await waitFor(() => decoder.started.length === 4);
		expect(candidates.peakActive).toBe(2);
		expect(decoder.peakActive).toBe(4);
		decoder.release();

		await expect(execution).resolves.toMatchObject({
			completedBatches: 4,
			cpuWorkers: 4,
			databaseWorkers: 2
		});
	});

	it('never exceeds the database cap across read and write handoffs', async () => {
		const batches = createBatches(48);
		const databaseActivity = new DatabaseActivityProbe();
		const candidates = new CandidateFixtureRepository(
			batches,
			Promise.resolve(),
			databaseActivity
		);
		const repository = new ResumableBackfillRepository(
			batches,
			undefined,
			databaseActivity
		);

		await expect(
			new BackfillFullHistoryOperations(
				repository,
				candidates,
				new SelectiveDecoder('', Promise.resolve())
			).execute({
				batchLimit: 24,
				cpuWorkerCount: 12,
				databaseWorkerCount: 2,
				networkPassphrase
			})
		).resolves.toMatchObject({
			completedBatches: 24,
			databaseWorkers: 2
		});
		expect(databaseActivity.peakActive).toBe(2);
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
			accountReferenceFacts: 0,
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
	peakActive = 0;
	private active = 0;
	private readonly byCheckpoint: ReadonlyMap<
		number,
		FullHistoryCheckpointCandidate
	>;

	constructor(
		batches: readonly FullHistoryOperationBackfillBatch[],
		private readonly loadGate: Promise<void> = Promise.resolve(),
		private readonly databaseActivity?: DatabaseActivityProbe
	) {
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
		this.databaseActivity?.enter();
		this.loaded.push(target.checkpointLedger);
		this.active += 1;
		this.peakActive = Math.max(this.peakActive, this.active);
		try {
			await this.loadGate;
			if (this.databaseActivity !== undefined) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
			const candidate = this.byCheckpoint.get(target.checkpointLedger);
			if (candidate === undefined) throw new Error('Missing fixture candidate');
			return candidate;
		} finally {
			this.active -= 1;
			this.databaseActivity?.exit();
		}
	}
}

class GatedDecoder implements FullHistoryCheckpointDecoder {
	readonly operationAccountReferenceDecoderVersion =
		'worker-account-reference-test-v1';
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
	readonly operationAccountReferenceDecoderVersion =
		'worker-account-reference-test-v1';
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
		private readonly timeoutBatchId?: string,
		private readonly databaseActivity?: DatabaseActivityProbe
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
		this.databaseActivity?.enter();
		try {
			if (this.databaseActivity !== undefined) {
				await new Promise<void>((resolve) => setImmediate(resolve));
			}
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
				accountReferenceCount: input.operations.length,
				batchId: input.batchId,
				operationCount: input.operations.length,
				replayed
			};
		} finally {
			this.databaseActivity?.exit();
		}
	}

	attempts(batchId: string): number {
		return this.attemptCounts.get(batchId) ?? 0;
	}
}

class DatabaseActivityProbe {
	active = 0;
	peakActive = 0;

	enter(): void {
		this.active += 1;
		this.peakActive = Math.max(this.peakActive, this.active);
	}

	exit(): void {
		this.active -= 1;
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
	return {
		batchLimit,
		cpuWorkerCount,
		databaseWorkerCount: 2,
		networkPassphrase
	};
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
