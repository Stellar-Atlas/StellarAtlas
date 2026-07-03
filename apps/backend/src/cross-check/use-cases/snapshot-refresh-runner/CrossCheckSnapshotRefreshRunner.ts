import { err, ok, Result } from 'neverthrow';
import type { CrossCheckRefreshLock } from '../../domain/CrossCheckRefreshLock.js';

export interface CrossCheckSnapshotRefreshRecord {
	readonly generatedAt: string;
	readonly id: string;
	readonly status: string;
	readonly storedAt: string;
}

export interface CrossCheckSnapshotRefreshRepository<
	TRecord extends CrossCheckSnapshotRefreshRecord
> {
	findLatest(): Promise<TRecord | null>;
}

export interface CrossCheckSnapshotRefreshUseCase<
	TRefreshDTO,
	TRecord extends CrossCheckSnapshotRefreshRecord
> {
	execute(dto: TRefreshDTO): Promise<Result<TRecord, Error>>;
}

export interface CrossCheckSnapshotRefreshRunnerDTO<TRefreshDTO> {
	readonly freshnessMs: number;
	readonly refresh: TRefreshDTO;
}

export interface CrossCheckSnapshotRefreshRunnerLabels {
	readonly freshnessErrorLabel: string;
	readonly latestErrorLabel: string;
}

export type CrossCheckSnapshotRefreshRunnerOutcome<
	TRecord extends CrossCheckSnapshotRefreshRecord
> =
	| {
			readonly latest: TRecord | null;
			readonly status: 'skipped_locked';
	  }
	| {
			readonly latest: TRecord;
			readonly status: 'skipped_fresh';
	  }
	| {
			readonly latest: TRecord;
			readonly status: 'refreshed';
	  };

export class CrossCheckSnapshotRefreshRunner<
	TRecord extends CrossCheckSnapshotRefreshRecord,
	TRefreshDTO
> {
	constructor(
		private readonly lock: CrossCheckRefreshLock,
		private readonly repository: CrossCheckSnapshotRefreshRepository<TRecord>,
		private readonly refresh: CrossCheckSnapshotRefreshUseCase<
			TRefreshDTO,
			TRecord
		>,
		private readonly labels: CrossCheckSnapshotRefreshRunnerLabels,
		private readonly now: () => Date = () => new Date()
	) {}

	async execute(
		dto: CrossCheckSnapshotRefreshRunnerDTO<TRefreshDTO>
	): Promise<Result<CrossCheckSnapshotRefreshRunnerOutcome<TRecord>, Error>> {
		const lockResult = await this.lock.runExclusive<
			CrossCheckSnapshotRefreshRunnerOutcome<TRecord>
		>(async () => {
			const latest = await this.repository.findLatest();
			if (latest !== null) {
				const freshness = checkFreshness(
					latest,
					dto.freshnessMs,
					this.now(),
					this.labels
				);
				if (freshness.isErr()) return err(freshness.error);
				if (freshness.value) {
					return ok({
						latest,
						status: 'skipped_fresh'
					});
				}
			}

			const refreshResult = await this.refresh.execute(dto.refresh);
			if (refreshResult.isErr()) return err(refreshResult.error);

			return ok({
				latest: refreshResult.value,
				status: 'refreshed'
			});
		});

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
	latest: CrossCheckSnapshotRefreshRecord | null,
	freshnessMs: number,
	now: Date,
	labels: CrossCheckSnapshotRefreshRunnerLabels
): Result<boolean, Error> {
	if (latest === null) return ok(false);
	if (!Number.isFinite(freshnessMs) || freshnessMs < 0) {
		return err(
			new Error(
				`${labels.freshnessErrorLabel} freshnessMs must be non-negative`
			)
		);
	}

	const storedAt = new Date(latest.storedAt);
	if (Number.isNaN(storedAt.getTime())) {
		return err(new Error(`${labels.latestErrorLabel} has invalid storedAt`));
	}

	return ok(now.getTime() - storedAt.getTime() < freshnessMs);
}
