import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { Logger } from '@core/services/Logger.js';
import {
	ScpStatementPersistenceFatalError,
	ScpStatementPersistenceTimeoutError
} from '@network-scan/domain/scp/ScpStatementPersistenceError.js';
import type { CollectScpLive } from '../CollectScpLive.js';
import { CollectScpLiveLooped } from '../CollectScpLiveLooped.js';

describe('CollectScpLiveLooped', () => {
	it('continues the process loop after a settled canonical write timeout', async () => {
		const collect = mock<CollectScpLive>();
		const exceptionLogger = mock<ExceptionLogger>();
		const logger = mock<Logger>();
		const timeout = new ScpStatementPersistenceTimeoutError(100);
		const nextResult = deferred(
			ok({ latestLedger: 1n, observedStatements: 0, processedLedgers: 0 })
		);
		collect.execute
			.mockResolvedValueOnce(err(timeout))
			.mockReturnValueOnce(nextResult.promise);
		collect.shutDown.mockResolvedValue({
			canonicalDrained: true,
			projectionDrained: true
		});
		const loop = new CollectScpLiveLooped(collect, exceptionLogger, logger);

		const execution = loop.execute({ loopIntervalMs: 0 });
		await flushMicrotasks();
		expect(collect.execute).toHaveBeenCalledTimes(2);
		const shutdown = loop.shutDown(1_000);
		nextResult.resolve();

		await shutdown;
		await expect(execution).resolves.toBeUndefined();
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(timeout);
		expect(logger.error).toHaveBeenCalledWith(
			'Live SCP collector crawl failed',
			{ errorMessage: timeout.message }
		);
	});

	it('reports every collector drain component instead of forcing success', async () => {
		const collect = mock<CollectScpLive>();
		collect.shutDown.mockResolvedValue({
			canonicalDrained: false,
			projectionDrained: false
		});
		collect.execute.mockResolvedValue(
			ok({ latestLedger: 1n, observedStatements: 0, processedLedgers: 0 })
		);
		const loop = new CollectScpLiveLooped(
			collect,
			mock<ExceptionLogger>(),
			mock<Logger>()
		);

		await expect(loop.shutDown(1_000)).resolves.toEqual({
			canonicalDrained: false,
			iterationStopped: true,
			projectionDrained: false
		});
		expect(collect.shutDown).toHaveBeenCalledWith(expect.any(Number));
	});

	it('fails the process loop on non-retryable canonical persistence', async () => {
		const collect = mock<CollectScpLive>();
		const failure = new ScpStatementPersistenceFatalError(
			new Error('invalid SCP statement schema')
		);
		collect.execute.mockResolvedValue(err(failure));
		const loop = new CollectScpLiveLooped(
			collect,
			mock<ExceptionLogger>(),
			mock<Logger>()
		);

		await expect(loop.execute({ loopIntervalMs: 0 })).rejects.toBe(failure);
		expect(collect.execute).toHaveBeenCalledTimes(1);
	});
});

function deferred<T>(value: T) {
	let resolve: () => void = () => {};
	const promise = new Promise<T>((promiseResolve) => {
		resolve = () => promiseResolve(value);
	});
	return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
	for (let iteration = 0; iteration < 12; iteration += 1) {
		await Promise.resolve();
	}
}
