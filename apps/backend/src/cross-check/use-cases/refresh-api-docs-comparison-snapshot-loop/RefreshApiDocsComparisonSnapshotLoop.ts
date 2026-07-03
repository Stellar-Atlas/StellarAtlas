import 'reflect-metadata';
import type { Result } from 'neverthrow';
import type {
	RefreshApiDocsComparisonSnapshotRunnerDTO,
	RefreshApiDocsComparisonSnapshotRunnerOutcome
} from '../refresh-api-docs-comparison-snapshot-runner/RefreshApiDocsComparisonSnapshotRunner.js';
import { RefreshApiDocsComparisonSnapshotRunner } from '../refresh-api-docs-comparison-snapshot-runner/RefreshApiDocsComparisonSnapshotRunner.js';
import {
	CrossCheckSnapshotRefreshLoop,
	type CrossCheckSnapshotRefreshLoopTick
} from '../snapshot-refresh-loop/CrossCheckSnapshotRefreshLoop.js';

export interface RefreshApiDocsComparisonSnapshotLoopDTO extends RefreshApiDocsComparisonSnapshotRunnerDTO {
	readonly intervalMs: number;
	readonly loop: boolean;
}

export type RefreshApiDocsComparisonSnapshotLoopTick = (
	outcome: RefreshApiDocsComparisonSnapshotRunnerOutcome
) => void;

export class RefreshApiDocsComparisonSnapshotLoop {
	private readonly loop: CrossCheckSnapshotRefreshLoop<
		RefreshApiDocsComparisonSnapshotLoopDTO,
		RefreshApiDocsComparisonSnapshotRunnerDTO,
		RefreshApiDocsComparisonSnapshotRunnerOutcome
	>;

	constructor(
		runner: RefreshApiDocsComparisonSnapshotRunner,
		sleep?: (ms: number) => Promise<void>
	) {
		this.loop = new CrossCheckSnapshotRefreshLoop(
			runner,
			toRunnerDTO,
			'API docs comparison refresh loop stopped before run',
			sleep
		);
	}

	async execute(
		dto: RefreshApiDocsComparisonSnapshotLoopDTO,
		tick?: RefreshApiDocsComparisonSnapshotLoopTick
	): Promise<Result<RefreshApiDocsComparisonSnapshotRunnerOutcome, Error>> {
		return this.loop.execute(
			dto,
			tick as CrossCheckSnapshotRefreshLoopTick<RefreshApiDocsComparisonSnapshotRunnerOutcome>
		);
	}

	shutDown(): void {
		this.loop.shutDown();
	}
}

function toRunnerDTO(
	dto: RefreshApiDocsComparisonSnapshotLoopDTO
): RefreshApiDocsComparisonSnapshotRunnerDTO {
	return {
		freshnessMs: dto.freshnessMs,
		...(dto.radar !== undefined ? { radar: dto.radar } : {}),
		...(dto.stellarAtlas !== undefined
			? { stellarAtlas: dto.stellarAtlas }
			: {})
	};
}
