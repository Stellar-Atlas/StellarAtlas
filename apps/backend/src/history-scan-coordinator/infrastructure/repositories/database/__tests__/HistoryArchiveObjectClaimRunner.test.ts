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

	it('runs one fallback after two contended fast attempts', async () => {
		const claimed = object();
		const fast = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ outcome: 'contended' });
		const fallback = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ object: claimed, outcome: 'claimed' });

		await expect(
			claimWithBoundedContentionFallback(fast, fallback)
		).resolves.toBe(claimed);
		expect(fast).toHaveBeenCalledTimes(2);
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('uses the second fast attempt before the serialized fallback', async () => {
		const claimed = object();
		const fast = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValueOnce({ outcome: 'contended' })
			.mockResolvedValueOnce({ object: claimed, outcome: 'claimed' });
		const fallback = jest.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>();

		await expect(
			claimWithBoundedContentionFallback(fast, fallback)
		).resolves.toBe(claimed);
		expect(fast).toHaveBeenCalledTimes(2);
		expect(fallback).not.toHaveBeenCalled();
	});

	it('makes one final fast attempt after a contended fallback', async () => {
		const claimed = object();
		const fast = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValueOnce({ outcome: 'contended' })
			.mockResolvedValueOnce({ outcome: 'contended' })
			.mockResolvedValueOnce({ object: claimed, outcome: 'claimed' });
		const fallback = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ outcome: 'contended' });

		await expect(
			claimWithBoundedContentionFallback(fast, fallback)
		).resolves.toBe(claimed);
		expect(fast).toHaveBeenCalledTimes(3);
		expect(fallback).toHaveBeenCalledTimes(1);
	});

	it('retries briefly when another serialized fallback still owns the gate', async () => {
		const claimed = object();
		const fast = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValueOnce({ outcome: 'contended' })
			.mockResolvedValueOnce({ outcome: 'contended' })
			.mockResolvedValueOnce({ outcome: 'contended' })
			.mockResolvedValueOnce({ object: claimed, outcome: 'claimed' });
		const fallback = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ outcome: 'contended' });
		const wait = jest.fn(async () => undefined);

		await expect(
			claimWithBoundedContentionFallback(fast, fallback, wait)
		).resolves.toBe(claimed);
		expect(fast).toHaveBeenCalledTimes(4);
		expect(fallback).toHaveBeenCalledTimes(1);
		expect(wait).toHaveBeenCalledTimes(1);
		expect(wait).toHaveBeenCalledWith(5);
	});

	it('stops after the final bounded fast attempt is still contended', async () => {
		const fast = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ outcome: 'contended' });
		const fallback = jest
			.fn<() => Promise<HistoryArchiveObjectClaimAttempt>>()
			.mockResolvedValue({ outcome: 'contended' });
		const wait = jest.fn(async () => undefined);

		await expect(
			claimWithBoundedContentionFallback(fast, fallback, wait)
		).resolves.toBeNull();
		expect(fast).toHaveBeenCalledTimes(7);
		expect(fallback).toHaveBeenCalledTimes(1);
		expect(wait).toHaveBeenCalledTimes(4);
		expect(wait.mock.calls).toEqual([[5], [10], [20], [40]]);
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
