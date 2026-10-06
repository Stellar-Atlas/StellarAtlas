import { setImmediate } from 'node:timers/promises';
import type { Logger } from 'logger';
import { ArchiveBrokerRamDispatch } from '../ArchiveBrokerRamDispatch.js';
import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamContext,
	ArchiveBrokerRamSelected
} from '../ArchiveBrokerRamTypes.js';
import type { HistoryArchiveRamCandidatePage } from '../../../repositories/database/HistoryArchiveRamCandidateFeed.js';
import type { HistoryArchiveBrokerJob } from '../../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import type { HistoryArchiveBrokerConfig } from '../HistoryArchiveBrokerConfig.js';

const nowUs = 1_700_000_000_000_000n;
const root = 'https://ram.example';
const id = (index: number) =>
	`00000000-0000-0000-0000-${index.toString().padStart(12, '0')}`;
function candidate(
	index: number,
	overrides: Partial<ArchiveBrokerRamCandidate> = {}
): ArchiveBrokerRamCandidate {
	return {
		remoteId: id(index),
		archiveUrlIdentity: root,
		hostIdentity: 'ram.example',
		objectType: 'ledger',
		checkpointLedger: index * 64 + 63,
		objectOrder: 10,
		priority: 2,
		status: 'pending',
		attempts: 0,
		executionDisposition: 'executable',
		dependencyReady: true,
		transitionEffectsRequiredAtUs: null,
		transitionEffectsCompletedAtUs: null,
		dispatchToken: null,
		publishedAtUs: null,
		availableAtUs: String(nowUs - 10n),
		updatedAtUs: String(nowUs - 100n),
		...overrides
	};
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
const config: HistoryArchiveBrokerConfig = {
	batchSize: 120,
	canonicalFirstRoot: null,
	capacitySignalSubject: 'test.capacity',
	consumer: 'test',
	highWatermark: 120,
	maximumPerHost: 8,
	maximumPriority: 2,
	pollIntervalMs: 2_000,
	ramQueueEnabled: true,
	ramMaximumRows: 10_000,
	servers: ['nats://test'],
	stream: 'test',
	subject: 'test',
	token: undefined
};
function fixture(
	rows: ArchiveBrokerRamCandidate[] = [candidate(1)],
	options: Partial<HistoryArchiveBrokerConfig> = {}
) {
	let elapsed = 0;
	const state = new Map(rows.map((row) => [row.remoteId, row]));
	const feed = {
		snapshotPage: jest.fn(
			async (
				_cursor: string | null,
				_limit = 512
			): Promise<HistoryArchiveRamCandidatePage> => ({
				rows: [...state.values()],
				hasMore: false,
				nextCursor: [...state.keys()].at(-1) ?? null
			})
		),
		refreshIds: jest.fn(
			async (
				ids: readonly string[]
			): Promise<readonly ArchiveBrokerRamCandidate[]> =>
				ids.flatMap((key) => {
					const row = state.get(key);
					return row ? [row] : [];
				})
		),
		loadContext: jest.fn(
			async (
				canonicalRoot: string | null,
				roots: readonly string[] = []
			): Promise<ArchiveBrokerRamContext> => ({
				databaseNowUs: String(nowUs + BigInt(elapsed * 1_000)),
				canonicalRoot,
				canonicalIncomplete: false,
				controls: [],
				activeHosts: [],
				activeScopes: [],
				hostThrottles: [],
				excludedHosts: [],
				excludedRoots: [],
				rootSortRanks: roots.map((archiveUrlIdentity, sortRank) => ({
					archiveUrlIdentity,
					sortRank
				}))
			})
		)
	};
	const claim = jest.fn(
		async (
			selected: readonly ArchiveBrokerRamSelected[],
			_root: string | null
		): Promise<readonly HistoryArchiveBrokerJob[]> =>
			selected.map((row, index) => {
				const stored = state.get(row.remoteId);
				if (stored)
					state.set(row.remoteId, { ...stored, publishedAtUs: String(nowUs) });
				return {
					executionId: id(900 + index),
					priority: 2,
					selectedOrdinal: index + 1,
					job: {
						remoteId: row.remoteId,
						archiveUrl: root,
						objectType: 'ledger',
						objectKey: `ledger:${row.remoteId}`,
						objectUrl: `${root}/${row.remoteId}`,
						bucketHash: null,
						checkpointLedger: 63,
						claimAttempt: 1
					}
				};
			})
	);
	const logger = { info: jest.fn(), error: jest.fn() } as unknown as Logger;
	const wake = jest.fn();
	const dispatch = new ArchiveBrokerRamDispatch(
		feed,
		claim,
		{ ...config, ...options },
		logger,
		wake,
		() => elapsed
	);
	return {
		state,
		feed,
		claim,
		logger,
		wake,
		dispatch,
		advance: (ms: number) => {
			elapsed += ms;
		}
	};
}
async function settle() {
	for (let turn = 0; turn < 5; turn++) await setImmediate();
}
async function ready(test: ReturnType<typeof fixture>) {
	test.dispatch.setConnected(true);
	await settle();
}

describe('RAM dispatcher snapshot, invalidation and durable fallback ownership', () => {
	it('uses exact candidate claims once ready rather than requesting global selection', async () => {
		const test = fixture();
		await ready(test);
		const jobs = await test.dispatch.reserve(1, null);
		expect(jobs?.map((job) => job.job.remoteId)).toEqual([id(1)]);
		expect(test.claim).toHaveBeenCalledTimes(1);
		expect(test.feed.snapshotPage).toHaveBeenCalledWith(null, 512);
		await test.dispatch.close();
	});
	it('replays IDs changed during bootstrap after the page snapshot, including deletions', async () => {
		const test = fixture();
		const gate = deferred<HistoryArchiveRamCandidatePage>();
		test.feed.snapshotPage.mockImplementationOnce(() => gate.promise);
		test.dispatch.setConnected(true);
		test.state.delete(id(1));
		test.state.set(id(2), candidate(2));
		test.dispatch.notify({ ids: [id(1), id(2)] });
		gate.resolve({ rows: [candidate(1)], nextCursor: id(1), hasMore: false });
		await settle();
		expect(
			(await test.dispatch.reserve(1, null))?.map((job) => job.job.remoteId)
		).toEqual([id(2)]);
		expect(test.feed.refreshIds).toHaveBeenCalledWith([id(1), id(2)]);
		await test.dispatch.close();
	});
	it('retains a second update arriving during an in-flight refresh', async () => {
		const test = fixture();
		await ready(test);
		const gate = deferred<readonly ArchiveBrokerRamCandidate[]>();
		test.feed.refreshIds.mockImplementationOnce(() => gate.promise);
		test.dispatch.notify({ ids: [id(1)] });
		const reserving = test.dispatch.reserve(1, null);
		await setImmediate();
		test.state.delete(id(1));
		test.dispatch.notify({ ids: [id(1)] });
		gate.resolve([candidate(1)]);
		expect(await reserving).toBeNull();
		expect(test.feed.refreshIds).toHaveBeenCalledTimes(2);
		expect(test.claim).not.toHaveBeenCalled();
		await test.dispatch.close();
	});
	it('discards old-generation bootstrap results and fully rebuilds after reconnect', async () => {
		const test = fixture();
		const gate = deferred<HistoryArchiveRamCandidatePage>();
		test.feed.snapshotPage.mockImplementationOnce(() => gate.promise);
		test.dispatch.setConnected(true);
		test.dispatch.setConnected(false);
		test.state.clear();
		test.state.set(id(2), candidate(2));
		test.dispatch.setConnected(true);
		gate.resolve({ rows: [candidate(1)], nextCursor: id(1), hasMore: false });
		await settle();
		await test.dispatch.reserve(1, null);
		await settle();
		expect(
			(await test.dispatch.reserve(1, null))?.map((job) => job.job.remoteId)
		).toEqual([id(2)]);
		expect(test.feed.snapshotPage).toHaveBeenCalledTimes(2);
		await test.dispatch.close();
	});
	it.each([
		null,
		'invalid',
		{ ids: ['bad'] },
		{ ids: Array.from({ length: 129 }, () => id(1)) },
		{ unknown: true }
	])('rebuilds safely for malformed hint %j', async (hint) => {
		const test = fixture();
		await ready(test);
		test.dispatch.notify(hint);
		await settle();
		expect(test.feed.snapshotPage).toHaveBeenCalledTimes(2);
		expect((await test.dispatch.reserve(1, null))?.length).toBe(1);
		await test.dispatch.close();
	});
	it('bounds global fallback on an empty mirror and opens it again on cadence', async () => {
		const test = fixture([]);
		await ready(test);
		expect(await test.dispatch.reserve(1, null)).toBeNull();
		expect(await test.dispatch.reserve(1, null)).toEqual([]);
		test.advance(15_000);
		expect(await test.dispatch.reserve(1, null)).toBeNull();
		await test.dispatch.close();
	});
	it('bounds durable fallback while disconnected or a rebuild is pending', async () => {
		const test = fixture();
		expect(await test.dispatch.reserve(1, null)).toBeNull();
		expect(await test.dispatch.reserve(1, null)).toEqual([]);
		const gate = deferred<HistoryArchiveRamCandidatePage>();
		test.feed.snapshotPage.mockImplementationOnce(() => gate.promise);
		test.dispatch.setConnected(true);
		expect(await test.dispatch.reserve(1, null)).toEqual([]);
		gate.resolve({ rows: [], nextCursor: null, hasMore: false });
		await settle();
		await test.dispatch.close();
	});
	it('refreshes context on ID changes and preserves context invalidation arriving mid-query', async () => {
		const test = fixture();
		await ready(test);
		test.claim.mockResolvedValue([]);
		await test.dispatch.reserve(1, null);
		const original = test.feed.loadContext.getMockImplementation()!;
		const gate = deferred<ArchiveBrokerRamContext>();
		test.feed.loadContext.mockImplementationOnce(() => gate.promise);
		test.dispatch.notify({ context: true });
		const reserving = test.dispatch.reserve(1, null);
		await setImmediate();
		test.dispatch.notify({ context: true });
		gate.resolve(await original(null, [root]));
		await reserving;
		await test.dispatch.reserve(1, null);
		expect(test.feed.loadContext).toHaveBeenCalledTimes(3);
		await test.dispatch.close();
	});
	it('refreshes collation ranks for roots introduced by a later bounded dirty batch', async () => {
		const test = fixture([]);
		await ready(test);
		const ids = Array.from({ length: 2_049 }, (_, index) => id(index + 1));
		for (let offset = 0; offset < ids.length; offset += 128)
			test.dispatch.notify({ ids: ids.slice(offset, offset + 128) });
		test.state.set(
			id(2_049),
			candidate(2_049, {
				archiveUrlIdentity: 'https://new.example',
				hostIdentity: 'new.example'
			})
		);
		await test.dispatch.reserve(1, null);
		expect(
			(await test.dispatch.reserve(1, null))?.map((job) => job.job.remoteId)
		).toEqual([id(2_049)]);
		expect(test.logger.error).not.toHaveBeenCalled();
		await test.dispatch.close();
	});
	it('does not publish stale candidate IDs when the authoritative claim rejects them', async () => {
		const test = fixture();
		await ready(test);
		test.claim.mockResolvedValueOnce([]);
		expect(await test.dispatch.reserve(1, null)).toEqual([]);
		test.state.delete(id(1));
		expect(await test.dispatch.reserve(1, null)).toBeNull();
		expect(test.claim).toHaveBeenCalledTimes(1);
		await test.dispatch.close();
	});
	it('keeps the mirror and refreshes only selected IDs after a rolled-back empty claim', async () => {
		const test = fixture();
		await ready(test);
		test.claim.mockResolvedValueOnce([]);
		expect(await test.dispatch.reserve(1, null)).toEqual([]);
		expect(
			(await test.dispatch.reserve(1, null))?.map((job) => job.job.remoteId)
		).toEqual([id(1)]);
		expect(test.feed.snapshotPage).toHaveBeenCalledTimes(1);
		expect(test.feed.refreshIds).toHaveBeenCalledWith([id(1)]);
		expect(test.claim).toHaveBeenCalledTimes(2);
		expect(test.logger.error).not.toHaveBeenCalled();
		await test.dispatch.close();
	});
	it('leaves periodic residual capacity for recovery during sustained fresh trickle', async () => {
		const test = fixture();
		await ready(test);
		expect(await test.dispatch.reserve(2, null)).toBeNull();
		for (let index = 2; index <= 4; index++) {
			test.advance(1_000);
			test.state.clear();
			test.state.set(id(index), candidate(index));
			test.dispatch.notify({ ids: [id(index - 1), id(index)] });
			expect(
				(await test.dispatch.reserve(2, null))?.map((job) => job.job.remoteId)
			).toEqual([id(index)]);
		}
		test.advance(12_000);
		test.state.clear();
		test.state.set(id(5), candidate(5));
		test.dispatch.notify({ ids: [id(4), id(5)] });
		expect(await test.dispatch.reserve(2, null)).toBeNull();
		expect(test.claim).toHaveBeenCalledTimes(3);
		await test.dispatch.close();
	});
	it('keeps a full fresh batch in RAM even when the recovery fallback cadence is due', async () => {
		const test = fixture([candidate(1), candidate(2)]);
		await ready(test);
		expect(
			(await test.dispatch.reserve(2, null))?.map((job) => job.job.remoteId)
		).toEqual([id(1), id(2)]);
		expect(test.claim).toHaveBeenCalledTimes(1);
		await test.dispatch.close();
	});
	it('drains snapshot work and suppresses post-close wake or claims', async () => {
		const test = fixture();
		const gate = deferred<HistoryArchiveRamCandidatePage>();
		test.feed.snapshotPage.mockImplementationOnce(() => gate.promise);
		test.dispatch.setConnected(true);
		let closed = false;
		const closing = test.dispatch.close().then(() => {
			closed = true;
		});
		await setImmediate();
		expect(closed).toBe(false);
		gate.resolve({ rows: [candidate(1)], nextCursor: null, hasMore: false });
		await closing;
		expect(test.wake).not.toHaveBeenCalled();
		test.dispatch.notify({ ids: [id(1)] });
		test.dispatch.setConnected(true);
		expect(await test.dispatch.reserve(1, null)).toBeNull();
		expect(test.claim).not.toHaveBeenCalled();
	});
});
