import 'reflect-metadata';

import Kernel from '@core/infrastructure/Kernel.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { Logger } from '@core/services/Logger.js';
import { CollectScpLiveLooped } from '../../use-cases/collect-scp-live/CollectScpLiveLooped.js';
import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';
import {
	getScpLiveProcessShutdownTimeoutMs,
	parseScpLiveShutdownDrainTimeoutMs
} from './ScpLiveShutdownPolicy.js';

const defaultLoopIntervalMs = 1_000;
const kernelShutdownBudgetMs =
	scpStatementObservationPolicy.shutdownKernelBudgetMs;

void run();

async function run(): Promise<void> {
	const kernel = await Kernel.getInstance();
	const logger = kernel.container.get<Logger>('Logger');
	const exceptionLogger =
		kernel.container.get<ExceptionLogger>('ExceptionLogger');
	const useCase = kernel.container.get(CollectScpLiveLooped);
	const loopIntervalMs = getLoopIntervalMs();
	const drainTimeoutMs = parseScpLiveShutdownDrainTimeoutMs(
		process.env.SCP_LIVE_SHUTDOWN_DRAIN_TIMEOUT_MS
	);
	const shutdown = createShutdownController(
		useCase,
		kernel,
		logger,
		drainTimeoutMs,
		getScpLiveProcessShutdownTimeoutMs(drainTimeoutMs)
	);

	process
		.on('SIGTERM', () => shutdown.start('SIGTERM'))
		.on('SIGINT', () => shutdown.start('SIGINT'));

	try {
		logger.info('Starting live SCP collector', { loopIntervalMs });
		await useCase.execute({ loopIntervalMs });
	} catch (error) {
		const mappedError =
			error instanceof Error ? error : new Error(String(error));
		logger.error('Unexpected error while collecting live SCP', {
			errorMessage: mappedError.message
		});
		exceptionLogger.captureException(mappedError);
		if (shutdown.started()) {
			await shutdown.wait();
			return;
		}
		const forcedExit = setTimeout(() => {
			logger.error('Forced failed SCP collector kernel shutdown', {
				timeoutMs: kernelShutdownBudgetMs
			});
			process.exit(1);
		}, kernelShutdownBudgetMs);
		await shutdownKernel(kernel, logger);
		clearTimeout(forcedExit);
		process.exit(1);
	}

	if (shutdown.started()) {
		await shutdown.wait();
		return;
	}
	await shutdownKernel(kernel, logger);
}

function getLoopIntervalMs(): number {
	const rawValue =
		process.argv[2] ?? process.env.SCP_LIVE_COLLECTOR_INTERVAL_MS;
	if (!rawValue) return defaultLoopIntervalMs;
	const parsed = Number(rawValue);
	return Number.isInteger(parsed) && parsed >= 0
		? parsed
		: defaultLoopIntervalMs;
}

interface ShutdownController {
	start(signal: string): void;
	started(): boolean;
	wait(): Promise<void>;
}

function createShutdownController(
	useCase: CollectScpLiveLooped,
	kernel: Kernel,
	logger: Logger,
	drainTimeoutMs: number,
	processShutdownTimeoutMs: number
): ShutdownController {
	let shutdownStarted = false;
	let completion: Promise<void> | null = null;
	const start = (signal: string): void => {
		if (shutdownStarted) return;
		shutdownStarted = true;
		logger.info('Received shutdown signal, stopping live SCP collector', {
			signal
		});
		const forcedExit = setTimeout(() => {
			logger.error('Forced live SCP collector shutdown after timeout', {
				signal,
				timeoutMs: processShutdownTimeoutMs
			});
			process.exit(1);
		}, processShutdownTimeoutMs);
		completion = useCase
			.shutDown(drainTimeoutMs)
			.then(async (result) => {
				const drained =
					result.canonicalDrained &&
					result.projectionDrained &&
					result.iterationStopped;
				if (!drained) {
					logger.error('Live SCP collector did not drain before shutdown', {
						...result
					});
				}
				await shutdownKernel(kernel, logger);
				clearTimeout(forcedExit);
				process.exit(drained ? 0 : 1);
			})
			.catch(async (error: unknown) => {
				logger.error('Live SCP collector shutdown failed', {
					errorMessage: error instanceof Error ? error.message : String(error)
				});
				await shutdownKernel(kernel, logger);
				clearTimeout(forcedExit);
				process.exit(1);
			});
	};

	return {
		start,
		started: () => shutdownStarted,
		wait: async () => {
			if (completion !== null) await completion;
		}
	};
}

async function shutdownKernel(kernel: Kernel, logger: Logger): Promise<void> {
	logger.info('Shutting down kernel');
	await kernel.shutdown();
	logger.info('Done');
}
