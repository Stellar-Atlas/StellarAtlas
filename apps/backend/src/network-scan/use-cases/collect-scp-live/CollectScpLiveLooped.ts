import { inject, injectable } from 'inversify';
import type { Logger } from '@core/services/Logger.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { asyncSleep } from 'http-helper';
import {
	CollectScpLive,
	type CollectScpLiveShutdownResult
} from './CollectScpLive.js';
import { ScpStatementPersistenceTimeoutError } from '../../domain/scp/ScpStatementPersistenceError.js';

export interface CollectScpLiveLoopedDTO {
	loopIntervalMs: number;
}

export interface CollectScpLiveLoopedShutdownResult extends CollectScpLiveShutdownResult {
	iterationStopped: boolean;
}

@injectable()
export class CollectScpLiveLooped {
	private aborted = false;
	private activeIteration: Promise<void> | null = null;

	constructor(
		@inject(CollectScpLive)
		private collectScpLive: CollectScpLive,
		@inject('ExceptionLogger')
		private exceptionLogger: ExceptionLogger,
		@inject('Logger')
		private logger: Logger
	) {}

	async execute(dto: CollectScpLiveLoopedDTO): Promise<void> {
		while (!this.aborted) {
			const startedAt = Date.now();
			const execution = this.collectScpLive.execute();
			this.activeIteration = execution.then(() => undefined);
			const result = await execution;
			this.activeIteration = null;

			if (result.isErr()) {
				this.exceptionLogger.captureException(result.error);
				this.logger.error('Live SCP collector crawl failed', {
					errorMessage: result.error.message
				});
				if (result.error instanceof ScpStatementPersistenceTimeoutError) {
					throw result.error;
				}
			}

			const remainingMs = Math.max(
				0,
				dto.loopIntervalMs - (Date.now() - startedAt)
			);
			if (remainingMs > 0 && !this.aborted) await asyncSleep(remainingMs);
		}
	}

	async shutDown(
		timeoutMs: number
	): Promise<CollectScpLiveLoopedShutdownResult> {
		this.aborted = true;
		const deadlineMs = Date.now() + Math.max(0, timeoutMs);
		const collectorResult = await this.collectScpLive.shutDown(
			Math.max(0, deadlineMs - Date.now())
		);
		const iteration = this.activeIteration;
		const iterationStopped =
			iteration === null ? true : await settlesBefore(iteration, deadlineMs);
		return { ...collectorResult, iterationStopped };
	}
}

async function settlesBefore(
	operation: Promise<void>,
	deadlineMs: number
): Promise<boolean> {
	const remainingMs = Math.max(0, deadlineMs - Date.now());
	if (remainingMs === 0) return false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation.then(
				() => true,
				() => false
			),
			new Promise<boolean>((resolve) => {
				timeout = setTimeout(() => resolve(false), remainingMs);
			})
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}
