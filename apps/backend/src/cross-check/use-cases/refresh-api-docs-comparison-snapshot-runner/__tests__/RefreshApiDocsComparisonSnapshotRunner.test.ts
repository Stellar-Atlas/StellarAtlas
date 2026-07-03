import { err, ok, Result } from 'neverthrow';
import type {
	CrossCheckApiDocsComparisonSnapshotRecordDTO,
	CrossCheckApiDocsComparisonSnapshotRepository,
	SaveCrossCheckApiDocsComparisonSnapshotDTO
} from '../../../domain/CrossCheckApiDocsSnapshot.js';
import type {
	CrossCheckApiDocsRefreshLock,
	CrossCheckApiDocsRefreshLockResult
} from '../../../domain/CrossCheckApiDocsRefreshLock.js';
import { RefreshApiDocsComparisonSnapshotRunner } from '../RefreshApiDocsComparisonSnapshotRunner.js';

describe('RefreshApiDocsComparisonSnapshotRunner', () => {
	it('should skip refresh when another process holds the lock', async () => {
		const latest = createRecord('latest', '2026-07-03T12:00:00.000Z');
		const repository = new FakeSnapshotRepository(latest);
		const refresh = new FakeRefresh(ok(createRecord('new')));
		const runner = new RefreshApiDocsComparisonSnapshotRunner(
			new FakeLock(false),
			repository,
			refresh as never
		);

		const result = await runner.execute({ freshnessMs: 0 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			latest,
			status: 'skipped_locked'
		});
		expect(refresh.calls).toEqual([]);
	});

	it('should skip refresh when the latest snapshot is still fresh', async () => {
		const latest = createRecord('latest', '2026-07-03T12:00:00.000Z');
		const refresh = new FakeRefresh(ok(createRecord('new')));
		const runner = new RefreshApiDocsComparisonSnapshotRunner(
			new FakeLock(true),
			new FakeSnapshotRepository(latest),
			refresh as never,
			() => new Date('2026-07-03T12:05:00.000Z')
		);

		const result = await runner.execute({ freshnessMs: 10 * 60 * 1000 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			latest,
			status: 'skipped_fresh'
		});
		expect(refresh.calls).toEqual([]);
	});

	it('should refresh when no snapshot exists', async () => {
		const refreshed = createRecord('new', '2026-07-03T12:10:00.000Z');
		const refresh = new FakeRefresh(ok(refreshed));
		const runner = new RefreshApiDocsComparisonSnapshotRunner(
			new FakeLock(true),
			new FakeSnapshotRepository(null),
			refresh as never
		);

		const result = await runner.execute({
			freshnessMs: 10 * 60 * 1000,
			radar: { maxBytes: 256, timeoutMs: 25 },
			stellarAtlas: { documentationUrl: '/docs' }
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toEqual({
			latest: refreshed,
			status: 'refreshed'
		});
		expect(refresh.calls).toEqual([
			{
				radar: { maxBytes: 256, timeoutMs: 25 },
				stellarAtlas: { documentationUrl: '/docs' }
			}
		]);
	});

	it('should refresh stale snapshots', async () => {
		const latest = createRecord('latest', '2026-07-03T11:00:00.000Z');
		const refreshed = createRecord('new', '2026-07-03T12:10:00.000Z');
		const runner = new RefreshApiDocsComparisonSnapshotRunner(
			new FakeLock(true),
			new FakeSnapshotRepository(latest),
			new FakeRefresh(ok(refreshed)) as never,
			() => new Date('2026-07-03T12:10:00.000Z')
		);

		const result = await runner.execute({ freshnessMs: 10 * 60 * 1000 });

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.status).toBe('refreshed');
		expect(result.value.latest.id).toBe('new');
	});

	it('should return refresh errors', async () => {
		const runner = new RefreshApiDocsComparisonSnapshotRunner(
			new FakeLock(true),
			new FakeSnapshotRepository(null),
			new FakeRefresh(err(new Error('refresh failed'))) as never
		);

		const result = await runner.execute({ freshnessMs: 0 });

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Expected refresh failure');
		expect(result.error.message).toBe('refresh failed');
	});

	it('should reject invalid latest storedAt values', async () => {
		const runner = new RefreshApiDocsComparisonSnapshotRunner(
			new FakeLock(true),
			new FakeSnapshotRepository(createRecord('bad', 'not-a-date')),
			new FakeRefresh(ok(createRecord('new'))) as never
		);

		const result = await runner.execute({ freshnessMs: 10 * 60 * 1000 });

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Expected invalid storedAt failure');
		expect(result.error.message).toBe(
			'Latest API docs snapshot has invalid storedAt'
		);
	});
});

class FakeLock implements CrossCheckApiDocsRefreshLock {
	constructor(private readonly acquired: boolean) {}

	async runExclusive<T>(
		work: () => Promise<Result<T, Error>>
	): Promise<Result<CrossCheckApiDocsRefreshLockResult<T>, Error>> {
		if (!this.acquired) return ok({ acquired: false });
		const result = await work();
		if (result.isErr()) return err(result.error);
		return ok({ acquired: true, value: result.value });
	}
}

class FakeSnapshotRepository implements CrossCheckApiDocsComparisonSnapshotRepository {
	constructor(
		private readonly latest: CrossCheckApiDocsComparisonSnapshotRecordDTO | null
	) {}

	async findLatest(): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO | null> {
		return this.latest;
	}

	async save(
		_snapshot: SaveCrossCheckApiDocsComparisonSnapshotDTO
	): Promise<CrossCheckApiDocsComparisonSnapshotRecordDTO> {
		throw new Error('Fake repository save should not be called');
	}
}

class FakeRefresh {
	readonly calls: unknown[] = [];

	constructor(
		private readonly result: Result<
			CrossCheckApiDocsComparisonSnapshotRecordDTO,
			Error
		>
	) {}

	async execute(
		dto: unknown
	): Promise<Result<CrossCheckApiDocsComparisonSnapshotRecordDTO, Error>> {
		this.calls.push(dto);
		return this.result;
	}
}

function createRecord(
	id: string,
	storedAt = '2026-07-03T12:00:00.000Z'
): CrossCheckApiDocsComparisonSnapshotRecordDTO {
	return {
		comparison: null,
		failure: {
			kind: 'timeout',
			message: 'RADAR timed out',
			occurredAt: '2026-07-03T12:00:00.000Z',
			phase: 'radar_fetch',
			sourceId: 'withobsrvr-radar'
		},
		generatedAt: '2026-07-03T12:00:00.000Z',
		id,
		status: 'failed',
		storedAt
	};
}
