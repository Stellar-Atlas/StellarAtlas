import type { Result } from 'neverthrow';
import type {
	CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
	CrossCheckRadarNetworkComparisonSnapshotRepository,
	RefreshRadarNetworkComparisonSnapshotDTO
} from '../../domain/CrossCheckRadarNetworkSnapshot.js';
import type { CrossCheckRefreshLock } from '../../domain/CrossCheckRefreshLock.js';
import { RefreshRadarNetworkComparisonSnapshot } from '../refresh-radar-network-comparison-snapshot/RefreshRadarNetworkComparisonSnapshot.js';
import {
	CrossCheckSnapshotRefreshRunner,
	type CrossCheckSnapshotRefreshRunnerOutcome
} from '../snapshot-refresh-runner/CrossCheckSnapshotRefreshRunner.js';

export interface RefreshRadarNetworkComparisonSnapshotRunnerDTO extends RefreshRadarNetworkComparisonSnapshotDTO {
	readonly freshnessMs: number;
}

export type RefreshRadarNetworkComparisonSnapshotRunnerOutcome =
	CrossCheckSnapshotRefreshRunnerOutcome<CrossCheckRadarNetworkComparisonSnapshotRecordDTO>;

export class RefreshRadarNetworkComparisonSnapshotRunner {
	private readonly runner: CrossCheckSnapshotRefreshRunner<
		CrossCheckRadarNetworkComparisonSnapshotRecordDTO,
		RefreshRadarNetworkComparisonSnapshotDTO
	>;

	constructor(
		lock: CrossCheckRefreshLock,
		repository: CrossCheckRadarNetworkComparisonSnapshotRepository,
		refresh: RefreshRadarNetworkComparisonSnapshot,
		now: () => Date = () => new Date()
	) {
		this.runner = new CrossCheckSnapshotRefreshRunner(
			lock,
			repository,
			refresh,
			{
				freshnessErrorLabel: 'RADAR network refresh',
				latestErrorLabel: 'Latest RADAR network snapshot'
			},
			now
		);
	}

	async execute(
		dto: RefreshRadarNetworkComparisonSnapshotRunnerDTO
	): Promise<
		Result<RefreshRadarNetworkComparisonSnapshotRunnerOutcome, Error>
	> {
		return this.runner.execute({
			freshnessMs: dto.freshnessMs,
			refresh: toRefreshDTO(dto)
		});
	}
}

function toRefreshDTO(
	dto: RefreshRadarNetworkComparisonSnapshotRunnerDTO
): RefreshRadarNetworkComparisonSnapshotDTO {
	return {
		...(dto.radar !== undefined ? { radar: dto.radar } : {})
	};
}
