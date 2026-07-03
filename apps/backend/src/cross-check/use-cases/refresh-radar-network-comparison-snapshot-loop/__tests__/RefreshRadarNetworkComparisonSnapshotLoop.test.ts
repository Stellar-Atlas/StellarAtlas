import { err, ok, Result } from 'neverthrow';
import type { CrossCheckRadarNetworkComparisonSnapshotRecordDTO } from '../../../domain/CrossCheckRadarNetworkSnapshot.js';
import type { RefreshRadarNetworkComparisonSnapshotRunnerOutcome } from '../../refresh-radar-network-comparison-snapshot-runner/RefreshRadarNetworkComparisonSnapshotRunner.js';
import { RefreshRadarNetworkComparisonSnapshotLoop } from '../RefreshRadarNetworkComparisonSnapshotLoop.js';

describe('RefreshRadarNetworkComparisonSnapshotLoop', () => {
	it('should run one refresh when loop mode is disabled', async () => {
		const runner = new FakeRunner([ok(createOutcome('snapshot-1'))]);
		const sleeps: number[] = [];
		const loop = new RefreshRadarNetworkComparisonSnapshotLoop(
			runner as never,
			(ms) => {
				sleeps.push(ms);
				return Promise.resolve();
			}
		);

		const result = await loop.execute({
			freshnessMs: 300000,
			intervalMs: 60000,
			loop: false,
			radar: { maxBytes: 100, timeoutMs: 25 }
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.latest?.id).toBe('snapshot-1');
		expect(runner.calls).toEqual([
			{
				freshnessMs: 300000,
				radar: { maxBytes: 100, timeoutMs: 25 }
			}
		]);
		expect(sleeps).toEqual([]);
	});

	it('should repeat refreshes in loop mode until shutdown is requested', async () => {
		const runner = new FakeRunner([
			ok(createOutcome('snapshot-1')),
			ok(createOutcome('snapshot-2'))
		]);
		const sleeps: number[] = [];
		const loop = new RefreshRadarNetworkComparisonSnapshotLoop(
			runner as never,
			(ms) => {
				sleeps.push(ms);
				return Promise.resolve();
			}
		);
		const seen: string[] = [];

		const result = await loop.execute(
			{ freshnessMs: 300000, intervalMs: 120000, loop: true },
			(outcome) => {
				if (outcome.latest !== null) seen.push(outcome.latest.id);
				if (seen.length === 2) loop.shutDown();
			}
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.latest?.id).toBe('snapshot-2');
		expect(runner.calls).toHaveLength(2);
		expect(sleeps).toEqual([120000]);
		expect(seen).toEqual(['snapshot-1', 'snapshot-2']);
	});

	it('should stop on refresh errors', async () => {
		const runner = new FakeRunner([
			ok(createOutcome('snapshot-1')),
			err(new Error('refresh failed'))
		]);
		const loop = new RefreshRadarNetworkComparisonSnapshotLoop(
			runner as never,
			async () => undefined
		);

		const result = await loop.execute({
			freshnessMs: 300000,
			intervalMs: 60000,
			loop: true
		});

		expect(result.isErr()).toBe(true);
		if (result.isOk()) throw new Error('Expected refresh failure');
		expect(result.error.message).toBe('refresh failed');
		expect(runner.calls).toHaveLength(2);
	});

	it('should wake the default wait when shutdown is requested', async () => {
		const runner = new FakeRunner([ok(createOutcome('snapshot-1'))]);
		const loop = new RefreshRadarNetworkComparisonSnapshotLoop(runner as never);

		const resultPromise = loop.execute({
			freshnessMs: 300000,
			intervalMs: 60 * 60 * 1000,
			loop: true
		});
		await Promise.resolve();
		loop.shutDown();

		const result = await resultPromise;
		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.latest?.id).toBe('snapshot-1');
		expect(runner.calls).toHaveLength(1);
	});
});

class FakeRunner {
	readonly calls: unknown[] = [];

	constructor(
		private readonly results: Result<
			RefreshRadarNetworkComparisonSnapshotRunnerOutcome,
			Error
		>[]
	) {}

	async execute(
		dto: unknown
	): Promise<
		Result<RefreshRadarNetworkComparisonSnapshotRunnerOutcome, Error>
	> {
		this.calls.push(dto);
		const result = this.results.shift();
		if (result === undefined) throw new Error('No fake runner result');
		return result;
	}
}

function createOutcome(
	id: string
): RefreshRadarNetworkComparisonSnapshotRunnerOutcome {
	return {
		latest: createRecord(id),
		status: 'refreshed'
	};
}

function createRecord(
	id: string
): CrossCheckRadarNetworkComparisonSnapshotRecordDTO {
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
		storedAt: '2026-07-03T12:00:01.000Z'
	};
}
