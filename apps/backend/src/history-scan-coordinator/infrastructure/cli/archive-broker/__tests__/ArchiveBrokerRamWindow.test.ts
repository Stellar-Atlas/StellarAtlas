import { ArchiveBrokerRamScheduler } from '../ArchiveBrokerRamScheduler.js';
import {
	ArchiveBrokerRamWindow,
	workingWindowEligibility
} from '../ArchiveBrokerRamWindow.js';
import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamContext
} from '../ArchiveBrokerRamTypes.js';
import type {
	HistoryArchiveRamRootPage,
	HistoryArchiveRamWindowCursor,
	HistoryArchiveRamWindowPage
} from '../../../repositories/database/HistoryArchiveRamCandidateFeed.js';

const nowUs = 1_700_000_000_000_000n;
const root = 'https://ram.example';
const id = (index: number) =>
	`00000000-0000-0000-0000-${index.toString().padStart(12, '0')}`;

function candidate(
	index: number,
	archiveUrlIdentity = root,
	overrides: Partial<ArchiveBrokerRamCandidate> = {}
): ArchiveBrokerRamCandidate {
	return {
		remoteId: id(index),
		archiveUrlIdentity,
		hostIdentity: new URL(archiveUrlIdentity).host,
		objectType: 'ledger',
		checkpointLedger: index * 64 + 63,
		objectOrder: index,
		priority: 1,
		status: 'pending',
		attempts: 0,
		executionDisposition: 'executable',
		dependencyReady: true,
		transitionEffectsRequiredAtUs: null,
		transitionEffectsCompletedAtUs: null,
		dispatchToken: null,
		publishedAtUs: null,
		availableAtUs: String(nowUs),
		updatedAtUs: String(nowUs),
		...overrides
	};
}

function context(
	overrides: Partial<ArchiveBrokerRamContext> = {}
): ArchiveBrokerRamContext {
	return {
		databaseNowUs: String(nowUs),
		canonicalRoot: null,
		canonicalIncomplete: false,
		fallbackObjectIds: [],
		controls: [],
		activeHosts: [],
		activeScopes: [],
		hostThrottles: [],
		excludedHosts: [],
		excludedRoots: [],
		rootSortRanks: [{ archiveUrlIdentity: root, sortRank: 0 }],
		...overrides
	};
}

describe('ArchiveBrokerRamWindow', () => {
	it('continues after an admitted row without skipping the overflow row', async () => {
		const rows = [candidate(1), candidate(2), candidate(3)];
		const feed = {
			listRootPage: jest.fn(
				async (after: string | null): Promise<HistoryArchiveRamRootPage> => ({
					roots: after === null ? [root] : [],
					nextCursor: after === null ? root : null,
					hasMore: false
				})
			),
			windowPage: jest.fn(
				async (
				_archiveRoot: string,
				cursor: HistoryArchiveRamWindowCursor | null
				): Promise<HistoryArchiveRamWindowPage> => {
					const remaining = rows.filter((row) =>
						cursor === null || row.remoteId > cursor.remoteId
					);
					const last = remaining.at(-1);
					return {
						rows: remaining,
						nextCursor: last
							? { priority: last.priority, updatedAtUs: last.updatedAtUs, remoteId: last.remoteId }
							: null,
						hasMore: false
					};
				}
			)
		};
		const scheduler = new ArchiveBrokerRamScheduler(1);
		const window = new ArchiveBrokerRamWindow(feed, scheduler, 1, null);
		const refill = () => window.refill(() => true, (row) => scheduler.applyWindowRow(row, 1));

		await refill();
		expect(scheduler.ids()).toEqual([id(1)]);
		scheduler.remove([id(1)]);
		await refill();
		expect(scheduler.ids()).toEqual([id(2)]);
		scheduler.remove([id(2)]);
		await refill();
		expect(scheduler.ids()).toEqual([id(3)]);
		expect(feed.windowPage.mock.calls.map((call) => call[1]?.remoteId ?? null)).toEqual([
			null,
			id(1),
			id(2)
		]);
	});

	it('remembers filtered-prefix cursors across 262 roots without LRU restart', async () => {
		const roots = Array.from({ length: 262 }, (_, index) =>
			`https://root-${String(index).padStart(3, '0')}.example`
		);
		const calls = new Map<string, (HistoryArchiveRamWindowCursor | null)[]>();
		const feed = {
			listRootPage: jest.fn(
				async (
					after: string | null,
					limit = 8
				): Promise<HistoryArchiveRamRootPage> => {
					const remaining = roots.filter((item) => after === null || item > after);
					const page = remaining.slice(0, limit + 1);
					const selected = page.slice(0, limit);
					return {
						roots: selected,
						nextCursor: selected.at(-1) ?? null,
						hasMore: page.length > limit
					};
				}
			),
			windowPage: jest.fn(
				async (
					archiveUrlIdentity: string,
					cursor: HistoryArchiveRamWindowCursor | null
				): Promise<HistoryArchiveRamWindowPage> => {
					const rootCalls = calls.get(archiveUrlIdentity) ?? [];
					rootCalls.push(cursor);
					calls.set(archiveUrlIdentity, rootCalls);
					if (cursor === null) {
						return {
							rows: [],
							nextCursor: {
								priority: 1,
								updatedAtUs: String(nowUs),
								remoteId: id(900_000 + roots.indexOf(archiveUrlIdentity))
							},
							hasMore: true
						};
					}
					const row = candidate(roots.indexOf(archiveUrlIdentity) + 1, archiveUrlIdentity);
					return {
						rows: [row],
						nextCursor: {
							priority: row.priority,
							updatedAtUs: row.updatedAtUs,
							remoteId: row.remoteId
						},
						hasMore: false
					};
				}
			)
		};
		const scheduler = new ArchiveBrokerRamScheduler(1024);
		const window = new ArchiveBrokerRamWindow(feed, scheduler, 1, null);
		for (let pass = 0; pass < 70; pass++) {
			await window.refill(() => true, (row) => scheduler.applyWindowRow(row, 1));
		}

		expect(scheduler.ids()).toHaveLength(262);
		expect(new Set(scheduler.ids()).size).toBe(262);
		expect(calls.size).toBe(262);
		for (const rootCalls of calls.values()) {
			expect(rootCalls).toHaveLength(2);
			expect(rootCalls[0]).toBeNull();
			expect(rootCalls[1]).not.toBeNull();
		}
	});

	it('visits canonical and bounded directory roots in one refill', async () => {
		const canonicalRoot = 'https://canonical.example';
		const roots = Array.from({ length: 7 }, (_, index) =>
			`https://directory-${index}.example`
		);
		const feed = {
			listRootPage: jest.fn(
				async (
					after: string | null,
					limit = 8
				): Promise<HistoryArchiveRamRootPage> => {
					const remaining = roots.filter((item) => after === null || item > after);
					const selected = remaining.slice(0, limit + 1);
					return {
						roots: selected.slice(0, limit),
						nextCursor: selected.slice(0, limit).at(-1) ?? null,
						hasMore: selected.length > limit
					};
				}
			),
			windowPage: jest.fn(
				async (_root: string, _cursor: HistoryArchiveRamWindowCursor | null): Promise<HistoryArchiveRamWindowPage> => ({
					rows: [],
					nextCursor: null,
					hasMore: false
				})
			)
		};
		const scheduler = new ArchiveBrokerRamScheduler(32);
		const window = new ArchiveBrokerRamWindow(feed, scheduler, 1, canonicalRoot);

		const result = await window.refill(() => true, (row) => scheduler.applyWindowRow(row, 1));

		expect(result.roots).toBe(8);
		expect(feed.listRootPage).toHaveBeenCalledWith(null, 7);
		expect(feed.windowPage).toHaveBeenCalledTimes(8);
		expect(feed.windowPage.mock.calls.map((call) => call[0])).toEqual([
			canonicalRoot,
			...roots
		]);
	});
});

describe('workingWindowEligibility', () => {
	it('rejects dependency, time and wrong checkpoint rows but permits the probe target', () => {
		const contextWithControl = context({
			controls: [{
				archiveUrlIdentity: root,
				scope: '*',
				blockedUntilUs: null,
				probeLeaseUntilUs: null,
				unknownCount: 1,
				nextProbeCheckpoint: 127
			}]
		});
		const eligible = workingWindowEligibility(contextWithControl, 0);

		expect(eligible(candidate(1, root, { dependencyReady: false }))).toBe(false);
		expect(eligible(candidate(2, root, { availableAtUs: String(nowUs + 1_000_000n) }))).toBe(false);
		expect(eligible(candidate(3, root, { checkpointLedger: 63 }))).toBe(false);
		expect(eligible(candidate(4, root, { checkpointLedger: 127 }))).toBe(true);
		expect(workingWindowEligibility(contextWithControl, 0, 0)(
			candidate(4, root, { checkpointLedger: 127 })
		)).toBe(false);
	});
});
