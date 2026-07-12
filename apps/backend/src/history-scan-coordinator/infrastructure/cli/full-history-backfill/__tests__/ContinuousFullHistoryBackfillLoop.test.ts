import type { RunFullHistoryBackfillResult } from '../../../../use-cases/run-full-history-backfill/RunFullHistoryBackfill.js';
import {
	runContinuousFullHistoryBackfillLoop,
	type ContinuousFullHistoryBackfillCycleResult,
	type ContinuousFullHistoryBackfillLoopConfig,
	type ContinuousFullHistoryBackfillLoopEvent
} from '../ContinuousFullHistoryBackfillLoop.js';

const config: ContinuousFullHistoryBackfillLoopConfig = {
	errorBackoffMs: 90_000,
	evidenceRejectedBackoffMs: 60_000,
	heartbeatIntervalMs: 10_000,
	idleBackoffMs: 15_000,
	proofPendingBackoffMs: 30_000,
	successDelayMs: 250
};

describe('continuous full-history backfill loop', () => {
	it('serializes cycles and applies outcome-specific bounded delays', async () => {
		const results = [
			cycle({
				jobId: '00000000-0000-4000-8000-000000000001',
				processedCheckpoints: 1,
				status: 'completed'
			}),
			cycle({
				checkpointLedger: 127,
				jobId: '00000000-0000-4000-8000-000000000002',
				jobState: 'pending',
				processedCheckpoints: 0,
				status: 'proof-pending'
			}),
			cycle({
				checkpointLedger: 63,
				jobId: '00000000-0000-4000-8000-000000000003',
				jobState: 'pending',
				processedCheckpoints: 0,
				status: 'evidence-rejected'
			}),
			cycle({ status: 'idle' })
		];
		const waits: number[] = [];
		const events: ContinuousFullHistoryBackfillLoopEvent[] = [];
		let active = 0;
		let maximumActive = 0;
		let index = 0;
		let stopped = false;

		await runContinuousFullHistoryBackfillLoop(config, {
			emit: (event) => events.push(event),
			executeCycle: async () => {
				active += 1;
				maximumActive = Math.max(maximumActive, active);
				await Promise.resolve();
				const result = results[index];
				if (result === undefined) throw new Error('Unexpected extra cycle');
				index += 1;
				active -= 1;
				return result;
			},
			formatError: String,
			now: () => 1_000,
			shouldStop: () => stopped,
			wait: async (milliseconds) => {
				waits.push(milliseconds);
				if (waits.length === results.length) stopped = true;
			}
		});

		expect(maximumActive).toBe(1);
		expect(waits).toEqual([250, 30_000, 60_000, 15_000]);
		expect(
			events
				.filter((event) => event.event === 'outcome')
				.map((event) => event.runStatus)
		).toEqual(['completed', 'proof-pending', 'evidence-rejected', 'idle']);
	});

	it('backs off after an unexpected cycle failure and keeps the loop alive', async () => {
		const events: ContinuousFullHistoryBackfillLoopEvent[] = [];
		let stopped = false;
		await runContinuousFullHistoryBackfillLoop(config, {
			emit: (event) => events.push(event),
			executeCycle: async () => {
				throw new Error('database temporarily unavailable');
			},
			formatError: (error) =>
				error instanceof Error ? error.message : String(error),
			now: () => 2_000,
			shouldStop: () => stopped,
			wait: async (milliseconds) => {
				expect(milliseconds).toBe(90_000);
				stopped = true;
			}
		});
		expect(events).toContainEqual(
			expect.objectContaining({
				event: 'cycle-error',
				message: 'database temporarily unavailable',
				retryInMs: 90_000
			})
		);
	});

	it('emits startup and periodic structured heartbeats', async () => {
		const events: ContinuousFullHistoryBackfillLoopEvent[] = [];
		let now = 10_000;
		let stopped = false;
		let waits = 0;
		await runContinuousFullHistoryBackfillLoop(config, {
			emit: (event) => events.push(event),
			executeCycle: async () => cycle({ status: 'idle' }),
			formatError: String,
			now: () => now,
			shouldStop: () => stopped,
			wait: async (milliseconds) => {
				now += milliseconds;
				waits += 1;
				if (waits === 2) stopped = true;
			}
		});
		const heartbeats = events.filter((event) => event.event === 'heartbeat');
		expect(heartbeats).toHaveLength(2);
		expect(heartbeats[0]).toMatchObject({ cycle: 0, status: 'running' });
		expect(heartbeats[1]).toMatchObject({
			cycle: 2,
			lastOutcome: 'idle',
			status: 'running'
		});
	});
});

function cycle(
	run: RunFullHistoryBackfillResult
): ContinuousFullHistoryBackfillCycleResult {
	return {
		run,
		schedule: { status: 'canonical-unavailable' }
	};
}
