import { ArchiveBrokerRamScheduler } from '../ArchiveBrokerRamScheduler.js';
import { ArchiveBrokerIndexedHeap } from '../ArchiveBrokerIndexedHeap.js';
import { ramTimestamp } from '../ArchiveBrokerRamEligibility.js';
import type {
	ArchiveBrokerRamCandidate,
	ArchiveBrokerRamContext,
	ArchiveBrokerRamControl
} from '../ArchiveBrokerRamTypes.js';

const now = 1_700_000_000_000_000n;
const id = (value: number) =>
	`00000000-0000-0000-0000-${value.toString().padStart(12, '0')}`;
const rootA = 'https://a.example',
	rootB = 'https://b.example';
function row(
	value: number,
	options: Partial<ArchiveBrokerRamCandidate> = {}
): ArchiveBrokerRamCandidate {
	return {
		remoteId: id(value),
		archiveUrlIdentity: rootA,
		hostIdentity: 'a.example',
		objectType: 'ledger',
		checkpointLedger: value * 64 + 63,
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
		availableAtUs: String(now - 10n),
		updatedAtUs: String(now - 100n),
		...options
	};
}
function context(
	overrides: Partial<ArchiveBrokerRamContext> = {}
): ArchiveBrokerRamContext {
	return {
		databaseNowUs: String(now),
		canonicalRoot: null,
		canonicalIncomplete: false,
		controls: [],
		activeHosts: [],
		activeScopes: [],
		hostThrottles: [],
		excludedHosts: [],
		excludedRoots: [],
		rootSortRanks: [
			{ archiveUrlIdentity: rootA, sortRank: 0 },
			{ archiveUrlIdentity: rootB, sortRank: 1 }
		],
		...overrides
	};
}
function control(
	overrides: Partial<ArchiveBrokerRamControl> = {}
): ArchiveBrokerRamControl {
	return {
		archiveUrlIdentity: rootA,
		scope: 'ledger',
		blockedUntilUs: String(now - 1n),
		probeLeaseUntilUs: null,
		unknownCount: 0,
		nextProbeCheckpoint: null,
		...overrides
	};
}
function take(
	queue: ArchiveBrokerRamScheduler,
	ctx = context(),
	limit = 4,
	maximumPerHost = 8
) {
	return queue.take({
		limit,
		maximumPerHost,
		maximumPriority: 2,
		context: ctx
	});
}

describe('indexed RAM scheduling heaps', () => {
	it('matches a sorted oracle through interleaved updates, removals and non-destructive prefixes', () => {
		const heap = new ArchiveBrokerIndexedHeap<{
			remoteId: string;
			value: number;
		}>((a, b) => a.value - b.value || a.remoteId.localeCompare(b.remoteId));
		const expected = new Map<string, { remoteId: string; value: number }>();
		for (let i = 0; i < 1000; i++) {
			const key = id((i * 17) % 41);
			if (i % 4 === 0) {
				heap.remove(key);
				expected.delete(key);
			} else {
				const item = { remoteId: key, value: (i * 31) % 23 };
				heap.upsert(item);
				expected.set(key, item);
			}
			const sorted = [...expected.values()].sort(
				(a, b) => a.value - b.value || a.remoteId.localeCompare(b.remoteId)
			);
			expect(heap.first(9)).toEqual(sorted.slice(0, 9));
			expect(heap.size).toBe(expected.size);
		}
	});
});

describe('RAM first-pass scheduler', () => {
	it('round-robins roots and preserves exact microsecond age beyond the selected checkpoint prefix', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1, { updatedAtUs: String(now - 1n) }),
			row(2),
			row(99, { updatedAtUs: String(now - 1000n) }),
			row(3, {
				archiveUrlIdentity: rootB,
				hostIdentity: 'b.example',
				checkpointLedger: 63
			}),
			row(4, {
				archiveUrlIdentity: rootB,
				hostIdentity: 'b.example',
				checkpointLedger: 127
			})
		]);
		const result = take(queue);
		expect(result.map((value) => value.remoteId)).toEqual([
			id(1),
			id(3),
			id(2),
			id(4)
		]);
		expect(result[0]?.firstPassRootReadyAt).toBe(ramTimestamp(now - 1000n));
		expect(take(queue)).toEqual(result);
		expect(queue.size).toBe(5);
		queue.remove([id(1)]);
		expect(take(queue)[0]?.remoteId).toBe(id(2));
	});
	it('preserves NULL-first and object order before timestamps or IDs', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1, { checkpointLedger: 63, objectOrder: 20 }),
			row(2, { checkpointLedger: null }),
			row(3, { checkpointLedger: 63, objectOrder: 10 })
		]);
		expect(take(queue).map((value) => value.remoteId)).toEqual([
			id(2),
			id(3),
			id(1)
		]);
	});
	it('activates future rows at the exact DB-derived due time without rescanning active rows', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([row(1, { availableAtUs: String(now + 1n) })]);
		expect(take(queue)).toEqual([]);
		expect(queue.metrics.future).toBe(1);
		expect(
			queue.take({
				limit: 4,
				maximumPerHost: 8,
				maximumPriority: 2,
				context: context(),
				nowUs: String(now + 1n)
			})[0]?.remoteId
		).toBe(id(1));
		expect(queue.metrics.future).toBe(0);
	});
	it('never admits attempted, failed or published work through the first-pass path', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1, { attempts: 1 }),
			row(2, { status: 'failed' }),
			row(3, { publishedAtUs: String(now) }),
			row(4)
		]);
		expect(queue.size).toBe(1);
		expect(take(queue).map((value) => value.remoteId)).toEqual([id(4)]);
	});
	it('preserves token overrides only for execution, dependency, transition and canonical admission', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1, { dependencyReady: false }),
			row(2, { executionDisposition: 'deferred' }),
			row(3, { transitionEffectsRequiredAtUs: '1' }),
			row(4, {
				dependencyReady: false,
				executionDisposition: 'deferred',
				transitionEffectsRequiredAtUs: '1',
				dispatchToken: id(900)
			})
		]);
		const ctx = context({ canonicalRoot: rootB, canonicalIncomplete: true });
		expect(take(queue, ctx).map((value) => value.remoteId)).toEqual([id(4)]);
		expect(take(queue, { ...ctx, excludedHosts: ['a.example'] })).toEqual([]);
		expect(
			take(queue, {
				...ctx,
				hostThrottles: [
					{ hostIdentity: 'a.example', blockedUntilUs: String(now + 1n) }
				]
			})
		).toEqual([]);
		expect(
			take(queue, {
				...ctx,
				controls: [control({ probeLeaseUntilUs: String(now + 1n) })]
			})
		).toEqual([]);
	});
	it('intersects wildcard/category adaptive targets including NULL and leases', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1, { checkpointLedger: null }),
			row(2, { checkpointLedger: 127 }),
			row(3, { checkpointLedger: 191 })
		]);
		const adaptive = control({ unknownCount: 1, nextProbeCheckpoint: 127 });
		expect(
			take(queue, context({ controls: [adaptive] })).map(
				(value) => value.remoteId
			)
		).toEqual([id(2)]);
		expect(
			take(
				queue,
				context({
					controls: [
						adaptive,
						control({ scope: '*', unknownCount: 1, nextProbeCheckpoint: null })
					]
				})
			)
		).toEqual([]);
		expect(
			take(
				queue,
				context({
					controls: [control({ unknownCount: 1, nextProbeCheckpoint: null })]
				})
			).map((value) => value.remoteId)
		).toEqual([id(1)]);
		expect(
			take(
				queue,
				context({ controls: [control({ blockedUntilUs: String(now + 1n) })] })
			)
		).toEqual([]);
	});
	it('allows one probe per controlled scope and retains active publication/claim suppression', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([row(1), row(2), row(3, { objectType: 'results' })]);
		expect(take(queue, context({ controls: [control()] }))).toHaveLength(2);
		expect(
			take(queue, context({ controls: [control({ scope: '*' })] }))
		).toHaveLength(1);
		for (const field of ['published', 'scanning'] as const) {
			const active = {
				archiveUrlIdentity: rootA,
				objectType: 'results',
				published: 0,
				scanning: 0,
				[field]: 1
			};
			expect(
				take(
					queue,
					context({
						controls: [control({ scope: '*' })],
						activeScopes: [active]
					})
				)
			).toEqual([]);
			expect(
				take(queue, context({ controls: [control()], activeScopes: [active] }))
			).toHaveLength(2);
		}
	});
	it('applies shared-host caps after root rounds without sacrificing other hosts', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1),
			row(2),
			row(3, { archiveUrlIdentity: rootB }),
			row(4, { archiveUrlIdentity: rootB }),
			row(5, { hostIdentity: 'other.example', objectType: 'results' })
		]);
		const result = take(
			queue,
			context({ activeHosts: [{ hostIdentity: 'a.example', activeCount: 1 }] }),
			5,
			2
		);
		expect(result).toHaveLength(2);
		expect(result.some((value) => value.remoteId === id(5))).toBe(true);
	});
	it('uses supplied database collation ranks and fails explicitly if a root rank is missing', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([row(1), row(2, { archiveUrlIdentity: rootB })]);
		expect(
			take(
				queue,
				context({
					rootSortRanks: [
						{ archiveUrlIdentity: rootA, sortRank: 2 },
						{ archiveUrlIdentity: rootB, sortRank: 1 }
					]
				})
			)[0]?.remoteId
		).toBe(id(2));
		expect(() => take(queue, context({ rootSortRanks: [] }))).toThrow(
			'collation rank missing'
		);
	});
	it('coalesces updates/deletes without heap tombstone growth and tracks root moves', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([row(1)]);
		take(queue);
		for (let i = 0; i < 1000; i++)
			queue.apply([row(1, { updatedAtUs: String(now - BigInt(i)) })]);
		expect(queue.size).toBe(1);
		expect(queue.metrics.lanes).toBe(1);
		queue.apply([row(1, { archiveUrlIdentity: rootB })], [id(1)]);
		expect(queue.roots()).toEqual([rootB]);
		queue.apply([row(1, { attempts: 1 })]);
		expect(queue.size).toBe(0);
		expect(queue.metrics.lanes).toBe(0);
	});
	it('fails closed and clears the cache at its single explicit memory row ceiling', () => {
		const queue = new ArchiveBrokerRamScheduler(2);
		queue.apply([row(1), row(2)]);
		expect(() => queue.apply([row(3)])).toThrow('ceiling exceeded');
		expect(queue.size).toBe(0);
		queue.apply([row(1), row(1), row(2)]);
		expect(queue.size).toBe(2);
		queue.clear();
		expect(queue.roots()).toEqual([]);
	});
	it('visits bounded lane prefixes rather than the full healthy cache per take', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply(Array.from({ length: 10_000 }, (_, i) => row(i + 1)));
		expect(take(queue, context(), 120, 8)).toHaveLength(8);
		expect(queue.metrics.examinedLastTake).toBe(8);
		expect(take(queue, context(), 120, 8)).toHaveLength(8);
		expect(queue.metrics.examinedLastTake).toBe(8);
	});
	it('preserves one-microsecond ordering and exact ISO conversion', () => {
		const queue = new ArchiveBrokerRamScheduler();
		queue.apply([
			row(1, { checkpointLedger: 63, updatedAtUs: String(now + 2n) }),
			row(2, { checkpointLedger: 63, updatedAtUs: String(now + 1n) })
		]);
		expect(take(queue)[0]?.remoteId).toBe(id(2));
		expect(ramTimestamp(1n)).toBe('1970-01-01T00:00:00.000001Z');
		expect(ramTimestamp(-1n)).toBe('1969-12-31T23:59:59.999999Z');
	});
});
