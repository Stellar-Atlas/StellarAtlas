import type { FullHistoryCheckpointCandidate } from '../../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type { FullHistoryDecodedCheckpoint } from '../../../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	failedFullHistoryOperationWorkerResponse,
	successfulFullHistoryOperationWorkerResponse
} from '../FullHistoryOperationWorkerProtocol.js';
import {
	FullHistoryOperationDecodeWorkerError,
	type FullHistoryOperationWorkerFactory,
	type FullHistoryOperationWorkerHandle,
	WorkerThreadFullHistoryCheckpointDecoder
} from '../WorkerThreadFullHistoryCheckpointDecoder.js';

const emptyDecoded: FullHistoryDecodedCheckpoint = {
	ledgers: [],
	operationAccountReferences: [],
	operations: [],
	operationResults: [],
	results: [],
	transactions: []
};

describe('WorkerThreadFullHistoryCheckpointDecoder', () => {
	it('enforces capacity without retaining a hidden payload queue', async () => {
		const factory = new FakeWorkerFactory();
		const decoder = new WorkerThreadFullHistoryCheckpointDecoder(2, factory);
		const first = decoder.decode(candidate(63), 'Worker fixture network');
		const second = decoder.decode(candidate(127), 'Worker fixture network');

		await expect(
			decoder.decode(candidate(191), 'Worker fixture network')
		).rejects.toBeInstanceOf(FullHistoryOperationDecodeWorkerError);
		expect(factory.handles).toHaveLength(2);
		expect(decoder.metrics()).toMatchObject({
			activeWorkers: 2,
			peakActiveWorkers: 2,
			queuedTasks: 0,
			retryCount: 0,
			workerCapacity: 2
		});

		factory.handles[0]!.message(
			successfulFullHistoryOperationWorkerResponse(emptyDecoded)
		);
		factory.handles[1]!.message(
			successfulFullHistoryOperationWorkerResponse(emptyDecoded)
		);
		await expect(Promise.all([first, second])).resolves.toEqual([
			emptyDecoded,
			emptyDecoded
		]);
		expect(decoder.metrics()).toMatchObject({
			activeWorkers: 0,
			completedTasks: 2,
			failedTasks: 0,
			peakActiveWorkers: 2
		});
	});

	it('surfaces worker decode failure once and leaves no active worker for retry by a later invocation', async () => {
		const factory = new FakeWorkerFactory();
		const decoder = new WorkerThreadFullHistoryCheckpointDecoder(1, factory);
		const decoding = decoder.decode(candidate(63), 'Worker fixture network');
		factory.handles[0]!.message(
			failedFullHistoryOperationWorkerResponse(
				new Error('malformed XDR fixture')
			)
		);

		await expect(decoding).rejects.toThrow('malformed XDR fixture');
		expect(factory.handles[0]!.terminate).toHaveBeenCalledTimes(1);
		expect(decoder.metrics()).toMatchObject({
			activeWorkers: 0,
			completedTasks: 0,
			failedTasks: 1,
			retryCount: 0
		});
	});

	it('terminates a timed-out task and releases its worker capacity', async () => {
		const factory = new FakeWorkerFactory();
		const decoder = new WorkerThreadFullHistoryCheckpointDecoder(1, factory, 1);

		await expect(
			decoder.decode(candidate(63), 'Worker fixture network')
		).rejects.toThrow('bounded task timeout');
		expect(factory.handles[0]!.terminate).toHaveBeenCalledTimes(1);
		expect(decoder.metrics()).toMatchObject({
			activeWorkers: 0,
			completedTasks: 0,
			failedTasks: 1,
			queuedTasks: 0,
			retryCount: 0
		});
	});
});

class FakeWorkerFactory implements FullHistoryOperationWorkerFactory {
	readonly handles: FakeWorkerHandle[] = [];

	create(): FullHistoryOperationWorkerHandle {
		const handle = new FakeWorkerHandle();
		this.handles.push(handle);
		return handle;
	}
}

class FakeWorkerHandle implements FullHistoryOperationWorkerHandle {
	readonly terminate = jest.fn().mockResolvedValue(0);
	private errorListener: ((error: Error) => void) | undefined;
	private exitListener: ((exitCode: number) => void) | undefined;
	private messageListener: ((value: unknown) => void) | undefined;

	onError(listener: (error: Error) => void): void {
		this.errorListener = listener;
	}

	onExit(listener: (exitCode: number) => void): void {
		this.exitListener = listener;
	}

	onMessage(listener: (value: unknown) => void): void {
		this.messageListener = listener;
	}

	message(value: unknown): void {
		if (this.messageListener === undefined)
			throw new Error('No message listener');
		this.messageListener(value);
	}

	error(error: Error): void {
		if (this.errorListener === undefined) throw new Error('No error listener');
		this.errorListener(error);
	}

	exit(exitCode: number): void {
		if (this.exitListener === undefined) throw new Error('No exit listener');
		this.exitListener(exitCode);
	}
}

function candidate(checkpointLedger: number): FullHistoryCheckpointCandidate {
	const hash = FullHistoryHash.fromHex('01'.repeat(32));
	return {
		envelopes: [],
		ledgers: [],
		proof: {
			archiveUrlIdentity: 'https://archive.example',
			checkpointLedger: fullHistoryLedgerSequence(BigInt(checkpointLedger)),
			evaluatedAt: new Date('2026-07-12T00:00:00.000Z'),
			id: checkpointLedger,
			networkPassphrase: 'Worker fixture network',
			sources: {
				checkpointState: source(hash, 1),
				ledger: source(hash, 2),
				results: source(hash, 3),
				transactions: source(hash, 4)
			},
			version: 1
		},
		results: []
	};
}

function source(hash: FullHistoryHash, seed: number) {
	return {
		contentDigest: hash,
		remoteId: `00000000-0000-4000-8000-${String(seed).padStart(12, '0')}`
	};
}
