import { inject, injectable } from 'inversify';
import type { Logger } from '../../../core/services/Logger.js';
import { ScanNetworkLoopedDTO } from './ScanNetworkLoopedDTO.js';
import { ScanNetwork } from '../scan-network/ScanNetwork.js';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import { LoopTimer } from '../../../core/services/LoopTimer.js';
import { asyncSleep } from 'http-helper';
import { err, ok, Result } from 'neverthrow';

@injectable()
export class ScanNetworkLooped {
	private aborted = false;

	constructor(
		@inject(ScanNetwork)
		private scanNetworkUseCase: ScanNetwork,
		@inject(LoopTimer)
		private loopTimer: LoopTimer,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger,
		@inject('Logger') protected logger: Logger
	) {}

	async execute(
		dto: ScanNetworkLoopedDTO,
		tick?: () => void
	): Promise<Result<void, Error>> {
		let firstRun = true;
		let error: Error | undefined;

		while (!this.aborted) {
			const result = await this.scanNetwork(firstRun, dto);
			if (result.isErr()) {
				this.exceptionLogger.captureException(result.error);
				this.aborted = true;
				error = result.error;
			}
			if (tick) tick();
			firstRun = false;
		}

		if (error) return err(error);
		return ok(undefined);
	}

	private async scanNetwork(
		firstRun: boolean,
		dto: ScanNetworkLoopedDTO
	): Promise<Result<void, Error>> {
		this.loopTimer.start(dto.loopIntervalMs);
		const result = await this.scanNetworkUseCase.execute({
			updateNetwork: firstRun,
			dryRun: dto.dryRun
		});
		this.loopTimer.stop();
		if (result.isErr()) {
			return err(result.error);
		}

		this.logger.info(
			'Scan network took ' + this.loopTimer.getElapsedTime() + 'ms'
		);

		if (this.loopTimer.loopExceededMaxTime()) {
			this.exceptionLogger.captureException(
				new Error('Network update exceeding expected run time')
			);
		}

		if (this.loopTimer.getRemainingTime() > 0) {
			await this.waitForNextRun(this.loopTimer.getRemainingTime());
		}

		return ok(undefined);
	}

	protected async waitForNextRun(waitTimeMs: number): Promise<void> {
		await asyncSleep(waitTimeMs);
	}

	public shutDown(callback: () => void) {
		this.aborted = true;
		this.scanNetworkUseCase.shutDown(callback);
	}
}
