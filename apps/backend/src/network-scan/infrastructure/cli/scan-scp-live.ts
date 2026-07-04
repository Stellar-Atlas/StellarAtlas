import 'reflect-metadata';

import Kernel from '@core/infrastructure/Kernel.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import type { Logger } from '@core/services/Logger.js';
import { CollectScpLiveLooped } from '../../use-cases/collect-scp-live/CollectScpLiveLooped.js';

const defaultLoopIntervalMs = 1_000;

void run();

async function run(): Promise<void> {
	const kernel = await Kernel.getInstance();
	const logger = kernel.container.get<Logger>('Logger');
	const exceptionLogger =
		kernel.container.get<ExceptionLogger>('ExceptionLogger');
	const useCase = kernel.container.get(CollectScpLiveLooped);
	const loopIntervalMs = getLoopIntervalMs();

	process
		.on('SIGTERM', shutdownGracefully('SIGTERM', useCase, kernel, logger))
		.on('SIGINT', shutdownGracefully('SIGINT', useCase, kernel, logger));

	try {
		logger.info('Starting live SCP collector', { loopIntervalMs });
		await useCase.execute({ loopIntervalMs });
	} catch (error) {
		const mappedError = error instanceof Error ? error : new Error(String(error));
		logger.error('Unexpected error while collecting live SCP', {
			errorMessage: mappedError.message
		});
		exceptionLogger.captureException(mappedError);
		await shutdownKernel(kernel, logger);
		process.exit(1);
	}

	await shutdownKernel(kernel, logger);
}

function getLoopIntervalMs(): number {
	const rawValue = process.argv[2] ?? process.env.SCP_LIVE_COLLECTOR_INTERVAL_MS;
	if (!rawValue) return defaultLoopIntervalMs;
	const parsed = Number(rawValue);
	return Number.isInteger(parsed) && parsed >= 0
		? parsed
		: defaultLoopIntervalMs;
}

function shutdownGracefully(
	signal: string,
	useCase: CollectScpLiveLooped,
	kernel: Kernel,
	logger: Logger
) {
	return (): void => {
		logger.info('Received shutdown signal, stopping live SCP collector', {
			signal
		});
		useCase.shutDown(async () => {
			await shutdownKernel(kernel, logger);
			process.exit(0);
		});
	};
}

async function shutdownKernel(kernel: Kernel, logger: Logger): Promise<void> {
	logger.info('Shutting down kernel');
	await kernel.shutdown();
	logger.info('Done');
}
