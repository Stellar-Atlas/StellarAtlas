import type { Result } from 'neverthrow';
import type {
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository
} from '../../domain/CrossCheckApiDocsSnapshot.js';
import type { CrossCheckApiDocsRefreshLock } from '../../domain/CrossCheckApiDocsRefreshLock.js';
import type { RefreshApiDocsComparisonSnapshotDTO } from '../refresh-api-docs-comparison-snapshot/RefreshApiDocsComparisonSnapshot.js';
import { RefreshApiDocsComparisonSnapshot } from '../refresh-api-docs-comparison-snapshot/RefreshApiDocsComparisonSnapshot.js';
import {
	CrossCheckSnapshotRefreshRunner,
	type CrossCheckSnapshotRefreshRunnerOutcome
} from '../snapshot-refresh-runner/CrossCheckSnapshotRefreshRunner.js';

export interface RefreshApiDocsComparisonSnapshotRunnerDTO extends RefreshApiDocsComparisonSnapshotDTO {
	readonly freshnessMs: number;
}

export type RefreshApiDocsComparisonSnapshotRunnerOutcome =
	CrossCheckSnapshotRefreshRunnerOutcome<CrossCheckApiDocsComparisonSnapshotRecordDTO>;

export class RefreshApiDocsComparisonSnapshotRunner {
	private readonly runner: CrossCheckSnapshotRefreshRunner<
		CrossCheckApiDocsComparisonSnapshotRecordDTO,
		RefreshApiDocsComparisonSnapshotDTO
	>;

	constructor(
		lock: CrossCheckApiDocsRefreshLock,
		repository: CrossCheckApiDocsComparisonSnapshotRepository,
		refresh: RefreshApiDocsComparisonSnapshot,
		now: () => Date = () => new Date()
	) {
		this.runner = new CrossCheckSnapshotRefreshRunner(
			lock,
			repository,
			refresh,
			{
				freshnessErrorLabel: 'API docs refresh',
				latestErrorLabel: 'Latest API docs snapshot'
			},
			now
		);
	}

	async execute(
		dto: RefreshApiDocsComparisonSnapshotRunnerDTO
	): Promise<Result<RefreshApiDocsComparisonSnapshotRunnerOutcome, Error>> {
		return this.runner.execute({
			freshnessMs: dto.freshnessMs,
			refresh: toRefreshDTO(dto)
		});
	}
}

function toRefreshDTO(
	dto: RefreshApiDocsComparisonSnapshotRunnerDTO
): RefreshApiDocsComparisonSnapshotDTO {
	return {
		...(dto.radar !== undefined ? { radar: dto.radar } : {}),
		...(dto.stellarAtlas !== undefined
			? { stellarAtlas: dto.stellarAtlas }
			: {})
	};
}
