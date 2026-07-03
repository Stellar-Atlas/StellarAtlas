import { err, ok, Result } from 'neverthrow';
import type {
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository
} from '../../domain/CrossCheckApiDocsSnapshot.js';
import type { CrossCheckApiDocsRefreshLock } from '../../domain/CrossCheckApiDocsRefreshLock.js';
import type { RefreshApiDocsComparisonSnapshotDTO } from '../refresh-api-docs-comparison-snapshot/RefreshApiDocsComparisonSnapshot.js';
import { RefreshApiDocsComparisonSnapshot } from '../refresh-api-docs-comparison-snapshot/RefreshApiDocsComparisonSnapshot.js';

export interface RefreshApiDocsComparisonSnapshotRunnerDTO extends RefreshApiDocsComparisonSnapshotDTO {
	readonly freshnessMs: number;
}

export type RefreshApiDocsComparisonSnapshotRunnerOutcome =
	| {
			readonly latest: CrossCheckApiDocsComparisonSnapshotRecordDTO | null;
			readonly status: 'skipped_locked';
	  }
	| {
			readonly latest: CrossCheckApiDocsComparisonSnapshotRecordDTO;
			readonly status: 'skipped_fresh';
	  }
	| {
			readonly latest: CrossCheckApiDocsComparisonSnapshotRecordDTO;
			readonly status: 'refreshed';
	  };

export class RefreshApiDocsComparisonSnapshotRunner {
	constructor(
		private readonly lock: CrossCheckApiDocsRefreshLock,
		private readonly repository: CrossCheckApiDocsComparisonSnapshotRepository,
		private readonly refresh: RefreshApiDocsComparisonSnapshot,
		private readonly now: () => Date = () => new Date()
	) {}

	async execute(
		dto: RefreshApiDocsComparisonSnapshotRunnerDTO
	): Promise<Result<RefreshApiDocsComparisonSnapshotRunnerOutcome, Error>> {
		const lockResult =
			await this.lock.runExclusive<RefreshApiDocsComparisonSnapshotRunnerOutcome>(
				async () => {
					const latest = await this.repository.findLatest();
					if (latest !== null) {
						const freshness = checkFreshness(
							latest,
							dto.freshnessMs,
							this.now()
						);
						if (freshness.isErr()) return err(freshness.error);
						if (freshness.value) {
							return ok({
								latest,
								status: 'skipped_fresh'
							});
						}
					}

					const refreshResult = await this.refresh.execute({
						radar: dto.radar,
						stellarAtlas: dto.stellarAtlas
					});
					if (refreshResult.isErr()) return err(refreshResult.error);

					return ok({
						latest: refreshResult.value,
						status: 'refreshed'
					});
				}
			);

		if (lockResult.isErr()) return err(lockResult.error);
		if (!lockResult.value.acquired) {
			return ok({
				latest: await this.repository.findLatest(),
				status: 'skipped_locked'
			});
		}

		return ok(lockResult.value.value);
	}
}

function checkFreshness(
	latest: CrossCheckApiDocsComparisonSnapshotRecordDTO | null,
	freshnessMs: number,
	now: Date
): Result<boolean, Error> {
	if (latest === null) return ok(false);
	if (!Number.isFinite(freshnessMs) || freshnessMs < 0) {
		return err(new Error('API docs refresh freshnessMs must be non-negative'));
	}

	const storedAt = new Date(latest.storedAt);
	if (Number.isNaN(storedAt.getTime())) {
		return err(new Error('Latest API docs snapshot has invalid storedAt'));
	}

	return ok(now.getTime() - storedAt.getTime() < freshnessMs);
}
