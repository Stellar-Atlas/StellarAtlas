import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	claimWithBoundedContentionFallback,
	type HistoryArchiveObjectClaimAttempt
} from '../HistoryArchiveObjectClaimRunner.js';

describe('HistoryArchiveObjectClaimRunner', () => {
	it('does not run the fallback for a claimed or idle fast path', async () => {
		const claimed = object();
		const fallback = jest.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>();

		await expect(
			claimWithBoundedContentionFallback(
				async () => ({ object: claimed, outcome: 'claimed' }),
				fallback
			)
		).resolves.toBe(claimed);
		await expect(
			claimWithBoundedContentionFallback(
				async () => ({ outcome: 'idle' }),
				fallback
			)
		).resolves.toBeNull();
		expect(fallback).not.toHaveBeenCalled();
	});

	it('runs exactly one fallback only after contention', async () => {
		const claimed = object();
		const fallback = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ object: claimed, outcome: 'claimed' });

		await expect(
			claimWithBoundedContentionFallback(
				async () => ({ outcome: 'contended' }),
				fallback
			)
		).resolves.toBe(claimed);
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('does not loop when the bounded fallback is still contended', async () => {
		const fallback = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ outcome: 'contended' });

		await expect(
			claimWithBoundedContentionFallback(
				async () => ({ outcome: 'contended' }),
				fallback
			)
		).resolves.toBeNull();
		expect(fallback).toHaveBeenCalledTimes(1);
	});
});

function object(): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl: 'https://claim-runner.example/archive',
		archiveUrlIdentity: 'https://claim-runner.example/archive',
		objectKey: 'root',
		objectOrder: 0,
		objectType: 'history-archive-state',
		objectUrl:
			'https://claim-runner.example/archive/.well-known/stellar-history.json'
	});
}
