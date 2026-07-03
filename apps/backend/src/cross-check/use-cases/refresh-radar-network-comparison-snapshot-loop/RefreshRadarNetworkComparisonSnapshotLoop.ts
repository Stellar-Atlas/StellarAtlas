import 'reflect-metadata';
import type { Result } from 'neverthrow';
import {
	CrossCheckSnapshotRefreshLoop,
	type CrossCheckSnapshotRefreshLoopTick
} from '../snapshot-refresh-loop/CrossCheckSnapshotRefreshLoop.js';
import type {
	RefreshRadarNetworkComparisonSnapshotRunnerDTO,
	RefreshRadarNetworkComparisonSnapshotRunnerOutcome
} from '../refresh-radar-network-comparison-snapshot-runner/RefreshRadarNetworkComparisonSnapshotRunner.js';
import { RefreshRadarNetworkComparisonSnapshotRunner } from '../refresh-radar-network-comparison-snapshot-runner/RefreshRadarNetworkComparisonSnapshotRunner.js';

export interface RefreshRadarNetworkComparisonSnapshotLoopDTO extends RefreshRadarNetworkComparisonSnapshotRunnerDTO {
	readonly intervalMs: number;
	readonly loop: boolean;
}

export type RefreshRadarNetworkComparisonSnapshotLoopTick = (
	outcome: RefreshRadarNetworkComparisonSnapshotRunnerOutcome
) => void;

export class RefreshRadarNetworkComparisonSnapshotLoop {
	private readonly loop: CrossCheckSnapshotRefreshLoop<
		RefreshRadarNetworkComparisonSnapshotLoopDTO,
		RefreshRadarNetworkComparisonSnapshotRunnerDTO,
		RefreshRadarNetworkComparisonSnapshotRunnerOutcome
	>;

	constructor(
		runner: RefreshRadarNetworkComparisonSnapshotRunner,
		sleep?: (ms: number) => Promise<void>
	) {
		this.loop = new CrossCheckSnapshotRefreshLoop(
			runner,
			toRunnerDTO,
			'RADAR network comparison refresh loop stopped before run',
			sleep
		);
	}

	async execute(
		dto: RefreshRadarNetworkComparisonSnapshotLoopDTO,
		tick?: RefreshRadarNetworkComparisonSnapshotLoopTick
	): Promise<
		Result<RefreshRadarNetworkComparisonSnapshotRunnerOutcome, Error>
	> {
		return this.loop.execute(
			dto,
			tick as CrossCheckSnapshotRefreshLoopTick<RefreshRadarNetworkComparisonSnapshotRunnerOutcome>
		);
	}

	shutDown(): void {
		this.loop.shutDown();
	}
}

function toRunnerDTO(
	dto: RefreshRadarNetworkComparisonSnapshotLoopDTO
): RefreshRadarNetworkComparisonSnapshotRunnerDTO {
	return {
		freshnessMs: dto.freshnessMs,
		...(dto.radar !== undefined ? { radar: dto.radar } : {})
	};
}
