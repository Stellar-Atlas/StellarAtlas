import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { Logger } from '@core/services/Logger.js';
import { ScpStatementPersistenceTimeoutError } from '@network-scan/domain/scp/ScpStatementPersistenceError.js';
import type { CollectScpLive } from '../CollectScpLive.js';
import { CollectScpLiveLooped } from '../CollectScpLiveLooped.js';

describe('CollectScpLiveLooped', () => {
	it('stops the process loop after an orphaned canonical write timeout', async () => {
		const collect = mock<CollectScpLive>();
		const exceptionLogger = mock<ExceptionLogger>();
		const logger = mock<Logger>();
		const timeout = new ScpStatementPersistenceTimeoutError(100);
		collect.execute.mockResolvedValue(err(timeout));
		const loop = new CollectScpLiveLooped(collect, exceptionLogger, logger);

		await expect(loop.execute({ loopIntervalMs: 0 })).rejects.toBe(timeout);
		expect(collect.execute).toHaveBeenCalledTimes(1);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(timeout);
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
});
