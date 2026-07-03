import 'reflect-metadata';
import { err, ok, Result } from 'neverthrow';
import type {
	RefreshApiDocsComparisonSnapshotRunnerDTO,
	RefreshApiDocsComparisonSnapshotRunnerOutcome
} from '../refresh-api-docs-comparison-snapshot-runner/RefreshApiDocsComparisonSnapshotRunner.js';
import { RefreshApiDocsComparisonSnapshotRunner } from '../refresh-api-docs-comparison-snapshot-runner/RefreshApiDocsComparisonSnapshotRunner.js';

export interface RefreshApiDocsComparisonSnapshotLoopDTO extends RefreshApiDocsComparisonSnapshotRunnerDTO {
	readonly intervalMs: number;
	readonly loop: boolean;
}

export type RefreshApiDocsComparisonSnapshotLoopTick = (
	outcome: RefreshApiDocsComparisonSnapshotRunnerOutcome
) => void;

export class RefreshApiDocsComparisonSnapshotLoop {
	private aborted = false;
	private wakeCurrentSleep: (() => void) | null = null;

	constructor(
		private readonly runner: RefreshApiDocsComparisonSnapshotRunner,
		private readonly sleep?: (ms: number) => Promise<void>
	) {}

	async execute(
		dto: RefreshApiDocsComparisonSnapshotLoopDTO,
		tick?: RefreshApiDocsComparisonSnapshotLoopTick
	): Promise<Result<RefreshApiDocsComparisonSnapshotRunnerOutcome, Error>> {
		let latestOutcome: RefreshApiDocsComparisonSnapshotRunnerOutcome | null =
			null;

		while (!this.aborted) {
			const result = await this.runner.execute({
				freshnessMs: dto.freshnessMs,
				radar: dto.radar,
				stellarAtlas: dto.stellarAtlas
			});
			if (result.isErr()) return err(result.error);

			latestOutcome = result.value;
			tick?.(latestOutcome);
			if (!dto.loop || this.aborted) break;

			await this.waitForNextRun(dto.intervalMs);
		}

		if (latestOutcome === null) {
			return err(
				new Error('API docs comparison refresh loop stopped before run')
			);
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
