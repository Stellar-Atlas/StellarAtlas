import { fullHistoryUint64 } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
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
