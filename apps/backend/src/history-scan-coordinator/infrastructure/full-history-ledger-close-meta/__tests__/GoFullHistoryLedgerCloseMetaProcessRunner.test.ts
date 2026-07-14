import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { jest } from '@jest/globals';

let nextChild: FakeChildProcess;
const spawn = jest.fn(
	(
		_command: string,
		_args: readonly string[],
		_options: Readonly<Record<string, unknown>>
	): FakeChildProcess => nextChild
);

jest.unstable_mockModule('node:child_process', () => ({ spawn }));

const {
	FULL_HISTORY_ETL_TERMINATION_GRACE_MILLISECONDS,
	runBoundedGoFullHistoryProcess
} = await import('../GoFullHistoryLedgerCloseMetaProcessRunner.js');

describe('runBoundedGoFullHistoryProcess', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		spawn.mockClear();
		nextChild = new FakeChildProcess();
	});

	afterEach(() => {
		nextChild.stdout.destroy();
		nextChild.stderr.destroy();
		jest.useRealTimers();
	});

	it('returns stdout after a successful close', async () => {
		const completion = runProcess();
		nextChild.emitSpawn();
		nextChild.stdout.write('receipt');
		nextChild.emitClose(0, null);

		await expect(completion).resolves.toEqual(Buffer.from('receipt'));
	});

	it('starts the parser with a minimal bounded runtime environment', async () => {
		const completion = runProcess();
		expect(spawn).toHaveBeenCalledWith(
			'/tmp/full-history-etl',
			['transform'],
			expect.objectContaining({
				env: {
					GOMAXPROCS: '4',
					GOMEMLIMIT: '6GiB',
					LANG: 'C',
					TZ: 'UTC'
				}
			})
		);
		nextChild.emitSpawn();
		nextChild.emitClose(0, null);
		await expect(completion).resolves.toEqual(Buffer.alloc(0));
	});

	it('waits for close after an error from an already-spawned child', async () => {
		const failure = new Error('child failure');
		const completion = observe(runProcess());
		nextChild.emitSpawn();
		nextChild.emitError(failure);

		await Promise.resolve();
		expect(completion.isSettled()).toBe(false);
		nextChild.emitClose(1, null);

		expect(await completion.outcome).toEqual({
			status: 'rejected',
			error: failure
		});
	});

	it('retains the first of multiple child errors until close', async () => {
		const first = new Error('first child failure');
		const completion = observe(runProcess());
		nextChild.emitSpawn();
		nextChild.emitError(first);
		nextChild.emitError(new Error('second child failure'));

		await Promise.resolve();
		expect(completion.isSettled()).toBe(false);
		nextChild.emitClose(1, null);

		expect(await completion.outcome).toEqual({
			status: 'rejected',
			error: first
		});
	});

	it('escalates an abort from SIGTERM to SIGKILL and waits for close', async () => {
		const controller = new AbortController();
		const failure = new Error('stop requested');
		const completion = observe(runProcess(controller, 60_000));
		nextChild.emitSpawn();

		controller.abort(failure);
		expect(nextChild.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
		await jest.advanceTimersByTimeAsync(
			FULL_HISTORY_ETL_TERMINATION_GRACE_MILLISECONDS - 1
		);
		expect(nextChild.kill).toHaveBeenCalledTimes(1);
		expect(completion.isSettled()).toBe(false);

		await jest.advanceTimersByTimeAsync(1);
		expect(nextChild.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
		expect(completion.isSettled()).toBe(false);
		nextChild.emitClose(null, 'SIGKILL');

		expect(await completion.outcome).toEqual({
			status: 'rejected',
			error: failure
		});
	});

	it('times out with the same bounded termination lifecycle', async () => {
		const completion = observe(runProcess(undefined, 1_000));
		nextChild.emitSpawn();

		await jest.advanceTimersByTimeAsync(1_000);
		expect(nextChild.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
		expect(completion.isSettled()).toBe(false);
		await jest.advanceTimersByTimeAsync(
			FULL_HISTORY_ETL_TERMINATION_GRACE_MILLISECONDS
		);
		expect(nextChild.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
		expect(completion.isSettled()).toBe(false);
		nextChild.emitClose(null, 'SIGKILL');

		const outcome = await completion.outcome;
		expect(outcome.status).toBe('rejected');
		if (outcome.status === 'rejected')
			expect(outcome.error).toEqual(
				expect.objectContaining({
					message: 'Full-history ETL exceeded its 1000ms timeout'
				})
			);
	});

	it('rejects a definitive spawn failure without waiting for close', async () => {
		const failure = new Error('ENOENT');
		const completion = runProcess();
		const assertion = expect(completion).rejects.toBe(failure);

		nextChild.emitError(failure);

		await assertion;
		expect(nextChild.kill).not.toHaveBeenCalled();
	});
});

class FakeChildProcess extends EventEmitter {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly kill = jest.fn<(processSignal?: NodeJS.Signals | number) => boolean>(
		() => true
	);

	emitSpawn(): void {
		this.emit('spawn');
	}

	emitError(error: Error): void {
		this.emit('error', error);
	}

	emitClose(code: number | null, processSignal: NodeJS.Signals | null): void {
		this.emit('close', code, processSignal);
	}
}

function runProcess(
	controller = new AbortController(),
	timeoutMilliseconds = 30_000
): Promise<Buffer> {
	return runBoundedGoFullHistoryProcess(
		'/tmp/full-history-etl',
		['transform'],
		timeoutMilliseconds,
		controller.signal
	);
}

function observe<T>(promise: Promise<T>): {
	readonly outcome: Promise<
		| { readonly status: 'fulfilled'; readonly value: T }
		| { readonly status: 'rejected'; readonly error: unknown }
	>;
	readonly isSettled: () => boolean;
} {
	let settled = false;
	return {
		outcome: promise.then(
			(value) => {
				settled = true;
				return { status: 'fulfilled' as const, value };
			},
			(error: unknown) => {
				settled = true;
				return { status: 'rejected' as const, error };
			}
		),
		isSettled: () => settled
	};
}
