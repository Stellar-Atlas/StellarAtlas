/// <reference types="jest" />

import {
	mergeArchiveEvidenceAggregate,
	startBoundedArchiveEvidenceRefresh,
	type ArchiveEvidenceRefreshClock
} from '../archive-evidence-refresh';

describe('archive evidence refresh', () => {
	it('is single-flight, visibility-aware, and clears its interval', async () => {
		const intervalCallbacks: Array<() => void> = [];
		const clearedIntervals: unknown[] = [];
		let visible = true;
		let refreshCount = 0;
		const refreshResolvers: Array<() => void> = [];
		const refresh = () => {
			refreshCount += 1;
			return new Promise<void>((resolve) => {
				refreshResolvers.push(resolve);
			});
		};
		const clock: ArchiveEvidenceRefreshClock = {
			clearInterval: (intervalId) => {
				clearedIntervals.push(intervalId);
			},
			isVisible: () => visible,
			setInterval: (next) => {
				intervalCallbacks.push(next);
				return 17;
			}
		};
		const stop = startBoundedArchiveEvidenceRefresh(refresh, 15_000, clock);
		const callback = intervalCallbacks[0];
		expect(callback).toBeDefined();
		if (callback === undefined) return;

		callback();
		callback();
		expect(refreshCount).toBe(1);
		refreshResolvers[0]?.();
		await Promise.resolve();
		callback();
		expect(refreshCount).toBe(2);
		visible = false;
		refreshResolvers[1]?.();
		await Promise.resolve();
		callback();
		expect(refreshCount).toBe(2);

		stop();
		expect(clearedIntervals).toEqual([17]);
	});

	it('merges refreshed aggregate fields without discarding loaded pages', () => {
		const current = {
			generatedAt: 'old',
			objectPage: { marker: 'kept' },
			total: 1
		};
		expect(
			mergeArchiveEvidenceAggregate(current, {
				generatedAt: 'new',
				total: 2
			})
		).toEqual({
			generatedAt: 'new',
			objectPage: { marker: 'kept' },
			total: 2
		});
	});
});
