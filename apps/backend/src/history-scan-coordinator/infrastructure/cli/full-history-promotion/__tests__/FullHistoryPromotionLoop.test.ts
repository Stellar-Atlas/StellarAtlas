import { fullHistoryUint64 } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryCanonicalError } from '../../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	runFullHistoryPromotionLoop,
	type FullHistoryPromotionLoopEvent
} from '../FullHistoryPromotionLoop.js';

describe('continuous full-history promotion loop', () => {
	it('promotes a bounded cycle and waits before the next cycle', async () => {
		const events: FullHistoryPromotionLoopEvent[] = [];
		let calls = 0;
		let stopped = false;
		const wait = jest.fn(async () => {
			stopped = true;
		});
		await runFullHistoryPromotionLoop(
			{
				errorBackoffMs: 30_000,
				maximumCheckpointsPerCycle: 2,
				networkPassphrase: 'test',
				pollIntervalMs: 1_000
			},
			{
				emit: (event) => events.push(event),
				promoteNext: async () => {
					calls += 1;
					return promoted(calls);
				},
				shouldStop: () => stopped,
				wait
			}
		);
		expect(calls).toBe(2);
		expect(events.map((event) => event.status)).toEqual([
			'promoted',
			'promoted'
		]);
		expect(wait).toHaveBeenCalledWith(1_000);
	});

	it('stops the cycle immediately when the next proof is pending', async () => {
		let calls = 0;
		let stopped = false;
		await runFullHistoryPromotionLoop(
			{
				errorBackoffMs: 30_000,
				maximumCheckpointsPerCycle: 8,
				networkPassphrase: 'test',
				pollIntervalMs: 1_000
			},
			{
				emit: () => undefined,
				promoteNext: async () => {
					calls += 1;
					return {
						checkpointLedger: 191,
						nextLedger: '128',
						status: 'proof-pending'
					};
				},
				shouldStop: () => stopped,
				wait: async () => {
					stopped = true;
				}
			}
		);
		expect(calls).toBe(1);
	});

	it('backs off after a failed cycle and continues without exposing the error', async () => {
		const events: FullHistoryPromotionLoopEvent[] = [];
		const waits: number[] = [];
		let calls = 0;
		let stopped = false;
		await runFullHistoryPromotionLoop(
			{
				errorBackoffMs: 30_000,
				maximumCheckpointsPerCycle: 1,
				networkPassphrase: 'test',
				pollIntervalMs: 1_000
			},
			{
				emit: (event) => events.push(event),
				promoteNext: async () => {
					calls += 1;
					if (calls === 1) {
						throw new FullHistoryCanonicalError(
							'watermark-gap',
							'postgresql://operator:secret@database.example'
						);
					}
					return promoted(calls);
				},
				shouldStop: () => stopped,
				wait: async (milliseconds) => {
					waits.push(milliseconds);
					if (milliseconds === 1_000) stopped = true;
				}
			}
		);

		expect(calls).toBe(2);
		expect(waits).toEqual([30_000, 1_000]);
		expect(events[0]).toEqual({
			errorCode: 'canonical-watermark-gap',
			retryInMs: 30_000,
			status: 'cycle-failed'
		});
		expect(events[1]).toMatchObject({ status: 'promoted' });
		expect(JSON.stringify(events)).not.toContain('operator:secret');
	});

	it('does not back off or report a failure after shutdown starts', async () => {
		const emit = jest.fn();
		const wait = jest.fn(async () => undefined);
		let stopped = false;
		await runFullHistoryPromotionLoop(
			{
				errorBackoffMs: 30_000,
				maximumCheckpointsPerCycle: 1,
				networkPassphrase: 'test',
				pollIntervalMs: 1_000
			},
			{
				emit,
				promoteNext: async () => {
					stopped = true;
					throw new Error('aborted');
				},
				shouldStop: () => stopped,
				wait
			}
		);

		expect(emit).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
	});
});

function promoted(sequence: number) {
	const checkpointLedger = 63 + sequence * 64;
	return {
		receipt: {
			batchId: `00000000-0000-8000-8000-${sequence.toString().padStart(12, '0')}`,
			nextLedger: fullHistoryUint64(BigInt(checkpointLedger + 1), 'nextLedger'),
			replayed: false
		},
		status: 'promoted' as const,
		target: {
			archiveUrlIdentity: 'https://archive.example',
			checkpointLedger,
			networkPassphrase: 'test'
		}
	};
}
