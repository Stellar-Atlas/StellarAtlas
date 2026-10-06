import 'reflect-metadata';
import { mock } from 'jest-mock-extended';
import { ok, type Result } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import type { JobMonitor } from 'job-monitor';
import type { Logger } from 'logger';
import type { HistoryArchiveWorkerStatusReporter } from '../../../domain/scan/HistoryArchiveWorkerStatusReporter.js';
import type {
	HistoryArchiveObjectCompletionDTO,
	HistoryArchiveObjectFailureDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import { BucketCache } from '../../../domain/scanner/BucketCache.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import type {
	HistoryArchiveObjectJobDelivery,
	HistoryArchiveObjectJobSource
} from '../HistoryArchiveObjectJobDelivery.js';
import type { HistoryArchiveDownloadPermit } from '../../../infrastructure/services/HistoryArchiveDownloadPermit.js';
import { VerifyArchiveObjects } from '../VerifyArchiveObjects.js';
import type { ArchiveObjectTerminalQueue } from '../ArchiveObjectTerminalQueue.js';

function delivery(id: string, source: 'broker' | 'legacy-http' = 'broker') {
	return mock<HistoryArchiveObjectJobDelivery>({
		source,
		executionId: `execution-${id}`,
		job: {
			remoteId: id,
			claimAttempt: 1,
			objectType: 'ledger',
			checkpointLedger: 63,
			bucketHash: null,
			archiveUrl: 'https://archive/',
			objectUrl: `https://archive/${id}`,
			objectKey: id
		}
	});
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { resolve, promise };
}
type Internals = {
	claimAndVerifyObject(slot: number): Promise<void>;
	performObjectVerification(): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	>;
	downloadPermit: HistoryArchiveDownloadPermit;
	terminalQueue: ArchiveObjectTerminalQueue;
};
function fixture() {
	const coordinator = mock<ScanCoordinatorService>();
	coordinator.completeHistoryArchiveObjects.mockImplementation(async (items) =>
		ok(items.map(() => ok(undefined)))
	);
	coordinator.completeHistoryArchiveObject.mockResolvedValue(ok(undefined));
	const source = mock<HistoryArchiveObjectJobSource>({ kind: 'broker' });
	const monitor = mock<JobMonitor>();
	monitor.checkIn.mockResolvedValue(ok(undefined));
	const reporter = mock<HistoryArchiveWorkerStatusReporter>();
	reporter.report.mockResolvedValue(ok(undefined));
	const verifier = new VerifyArchiveObjects(
		coordinator,
		source,
		reporter,
		mock<HttpService>(),
		mock<HistoryArchiveStateValidator>(),
		mock<BucketCache>(),
		mock<ExceptionLogger>(),
		monitor,
		1,
		1,
		mock<Logger>()
	);
	const internals = verifier as unknown as Internals;
	const permit = mock<HistoryArchiveDownloadPermit>();
	permit.acquire.mockResolvedValue(jest.fn());
	internals.downloadPermit = permit;
	const verify = jest
		.spyOn(internals, 'performObjectVerification')
		.mockResolvedValue(ok({}));
	return { verifier, internals, coordinator, source, verify };
}
describe('verification to terminal persistence handoff', () => {
	it('reuses the logical slot while the previous durable write is outstanding', async () => {
		const { verifier, internals, coordinator, source, verify } = fixture();
		const firstWrite =
			deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValueOnce(
			firstWrite.promise
		);
		const a = delivery('a'),
			b = delivery('b');
		source.next.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
		await internals.claimAndVerifyObject(0);
		expect(a.acknowledge).not.toHaveBeenCalled();
		const second = internals.claimAndVerifyObject(0);
		for (let turn = 0; turn < 12; turn++) await Promise.resolve();
		expect(verify).toHaveBeenCalledTimes(2);
		expect(internals.terminalQueue.metrics.pending).toBe(1);
		firstWrite.resolve(ok([ok(undefined)]));
		await second;
		await internals.terminalQueue.drain();
		await verifier.releaseActiveObjectJobs();
		expect(a.acknowledge).toHaveBeenCalledTimes(1);
		expect(b.acknowledge).toHaveBeenCalledTimes(1);
	});
	it('does not replace ownership or re-verify a duplicate pending delivery', async () => {
		const { verifier, internals, coordinator, source, verify } = fixture();
		const write = deferred<Result<readonly Result<void, Error>[], Error>>();
		coordinator.completeHistoryArchiveObjects.mockReturnValueOnce(
			write.promise
		);
		const a = delivery('a'),
			duplicate = delivery('a');
		source.next.mockResolvedValueOnce(a).mockResolvedValueOnce(duplicate);
		await internals.claimAndVerifyObject(0);
		await internals.claimAndVerifyObject(0);
		expect(verify).toHaveBeenCalledTimes(1);
		expect(duplicate.retry).toHaveBeenCalledWith(30_000);
		expect(duplicate.acknowledge).not.toHaveBeenCalled();
		write.resolve(ok([ok(undefined)]));
		await internals.terminalQueue.drain();
		await verifier.releaseActiveObjectJobs();
	});
	it('keeps legacy HTTP completion inline and never calls the batch route', async () => {
		const { verifier, internals, coordinator, source } = fixture();
		const write = deferred<Result<void, Error>>();
		coordinator.completeHistoryArchiveObject.mockReturnValue(write.promise);
		const a = delivery('a', 'legacy-http');
		source.next.mockResolvedValueOnce(a);
		let finished = false;
		const running = internals.claimAndVerifyObject(0).then(() => {
			finished = true;
		});
		for (let turn = 0; turn < 12; turn++) await Promise.resolve();
		expect(finished).toBe(false);
		expect(coordinator.completeHistoryArchiveObjects).not.toHaveBeenCalled();
		write.resolve(ok(undefined));
		await running;
		expect(a.acknowledge).toHaveBeenCalledTimes(1);
		await verifier.releaseActiveObjectJobs();
	});
	it('a pull returned after shutdown stays UNACKed without touching the drained connection', async () => {
		const { verifier, internals, source, verify } = fixture();
		const pull = deferred<HistoryArchiveObjectJobDelivery | null>();
		source.next.mockReturnValue(pull.promise);
		const running = internals.claimAndVerifyObject(0);
		await Promise.resolve();
		await verifier.releaseActiveObjectJobs();
		const a = delivery('a');
		pull.resolve(a);
		await running;
		expect(verify).not.toHaveBeenCalled();
		expect(a.retry).not.toHaveBeenCalled();
		expect(a.acknowledge).not.toHaveBeenCalled();
	});
});
