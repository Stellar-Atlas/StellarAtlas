import { inject, injectable } from 'inversify';
import type { Logger } from '@core/services/Logger.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { asyncSleep } from 'http-helper';
import { CollectScpLive } from './CollectScpLive.js';

export interface CollectScpLiveLoopedDTO {
	loopIntervalMs: number;
}

@injectable()
export class CollectScpLiveLooped {
	private aborted = false;
	private running = false;
	private shutdownCallback?: () => void;

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
			this.running = true;
			const result = await this.collectScpLive.execute();
			this.running = false;
			this.finishShutdownIfRequested();

			if (result.isErr()) {
				this.exceptionLogger.captureException(result.error);
				this.logger.error('Live SCP collector crawl failed', {
					errorMessage: result.error.message
				});
			}

			const remainingMs = Math.max(0, dto.loopIntervalMs - (Date.now() - startedAt));
			if (remainingMs > 0 && !this.aborted) await asyncSleep(remainingMs);
		}

		this.finishShutdownIfRequested();
	}

	shutDown(callback: () => void): void {
		this.aborted = true;
		this.shutdownCallback = callback;
		if (!this.running) this.finishShutdownIfRequested();
	}

	private finishShutdownIfRequested(): void {
		const callback = this.shutdownCallback;
		if (!callback || this.running) return;
		this.shutdownCallback = undefined;
		callback();
	}
}
