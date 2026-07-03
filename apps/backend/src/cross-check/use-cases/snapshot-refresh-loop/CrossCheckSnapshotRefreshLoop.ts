import 'reflect-metadata';
import { err, ok, Result } from 'neverthrow';

export interface CrossCheckSnapshotRefreshLoopDTO {
	readonly intervalMs: number;
	readonly loop: boolean;
}

export interface CrossCheckSnapshotRefreshLoopRunner<TRunnerDTO, TOutcome> {
	execute(dto: TRunnerDTO): Promise<Result<TOutcome, Error>>;
}

export type CrossCheckSnapshotRefreshLoopTick<TOutcome> = (
	outcome: TOutcome
) => void;

export class CrossCheckSnapshotRefreshLoop<
	TLoopDTO extends CrossCheckSnapshotRefreshLoopDTO,
	TRunnerDTO,
	TOutcome
> {
	private aborted = false;
	private wakeCurrentSleep: (() => void) | null = null;

	constructor(
		private readonly runner: CrossCheckSnapshotRefreshLoopRunner<
			TRunnerDTO,
			TOutcome
		>,
		private readonly toRunnerDTO: (dto: TLoopDTO) => TRunnerDTO,
		private readonly stoppedBeforeRunMessage: string,
		private readonly sleep?: (ms: number) => Promise<void>
	) {}

	async execute(
		dto: TLoopDTO,
		tick?: CrossCheckSnapshotRefreshLoopTick<TOutcome>
	): Promise<Result<TOutcome, Error>> {
		let latestOutcome: TOutcome | null = null;

		while (!this.aborted) {
			const result = await this.runner.execute(this.toRunnerDTO(dto));
			if (result.isErr()) return err(result.error);

			latestOutcome = result.value;
			tick?.(latestOutcome);
			if (!dto.loop || this.aborted) break;

			await this.waitForNextRun(dto.intervalMs);
		}

		if (latestOutcome === null) {
			return err(new Error(this.stoppedBeforeRunMessage));
		}

		return ok(latestOutcome);
	}

	shutDown(): void {
		this.aborted = true;
		this.wakeCurrentSleep?.();
	}

	private async waitForNextRun(ms: number): Promise<void> {
		if (this.sleep !== undefined) {
			await this.sleep(ms);
			return;
		}

		if (this.aborted) return;

		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				this.wakeCurrentSleep = null;
				resolve();
			}, ms);
			this.wakeCurrentSleep = () => {
				clearTimeout(timeout);
				this.wakeCurrentSleep = null;
				resolve();
			};
		});
	}
}
