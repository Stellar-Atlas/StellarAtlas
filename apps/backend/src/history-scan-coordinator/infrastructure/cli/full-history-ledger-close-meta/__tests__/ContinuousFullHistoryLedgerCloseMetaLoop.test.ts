import {
	fullHistoryLedgerCloseMetaRange as range,
	fullHistoryLedgerCloseMetaSha256Digest as digest,
	type FullHistoryLedgerCloseMetaRange
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaIngestionContext } from '../../../../use-cases/ingest-full-history-ledger-close-meta/IngestFullHistoryLedgerCloseMeta.js';
import { TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader } from '../../../database/full-history-ledger-close-meta/TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader.js';
import {
	runContinuousFullHistoryLedgerCloseMetaLoop as run,
	type ContinuousFullHistoryLedgerCloseMetaEvent,
	type ContinuousFullHistoryLedgerCloseMetaLoopConfig,
	type ContinuousFullHistoryLedgerCloseMetaLoopDependencies
} from '../ContinuousFullHistoryLedgerCloseMetaLoop.js';
import type { PendingPlan } from '../FullHistoryLedgerCloseMetaPendingPlan.js';

describe('runContinuousFullHistoryLedgerCloseMetaLoop', () => {
	it('offers one historical range after every four successful current ranges', async () => {
		const f = fixture(10);
		await run(f.config, f.dependencies);
		expect(f.selected.map(r => r.startSequence)).toEqual([
			1000, 1064, 1128, 1192, 3, 1256, 1320, 1384, 1448, 67
		]);
	});

	it('waits on denied history and requires fresh current admission', async () => {
		const f = fixture(6);
		let denied = false;
		f.dependencies.admitCycle = async current => {
			f.calls.push(current ? 'admit-current' : 'admit-history');
			if (!current && !denied) { denied = true; return denial(); }
			return { admitted: true };
		};
		await run(f.config, f.dependencies);
		const gate = f.calls.indexOf('admit-history');
		expect(f.calls.slice(gate, gate + 4)).toEqual([
			'admit-history', 'wait-10', 'admit-current', 'priority'
		]);
		expect(f.selected.map(r => r.startSequence)).toEqual([1000, 1064, 1128, 1192, 1256, 3]);
		expect(f.events.filter(e => e.event === 'admission-deferred')).toHaveLength(1);
	});

	it('a denied fresh current gate cannot reuse admission from before the historical wait', async () => {
		const f = fixture(5);
		let historyDenied = false;
		f.dependencies.admitCycle = async current => {
			f.calls.push(current ? 'admit-current' : 'admit-history');
			if (!current) { historyDenied = true; return denial(); }
			return historyDenied ? denial() : { admitted: true };
		};
		f.dependencies.wait = async ms => {
			f.calls.push(`wait-${ms}`);
			if (historyDenied && f.calls.at(-2) === 'admit-current') f.controller.abort();
		};
		await run(f.config, f.dependencies);
		expect(f.selected).toHaveLength(4);
		expect(f.calls.slice(f.calls.indexOf('admit-history'))).toEqual([
			'admit-history', 'wait-10', 'admit-current', 'wait-10'
		]);
	});

	it('retries resumed pending priority unchanged and counts its success once', async () => {
		const f = fixture(6);
		f.pending = plan('priority', 900);
		const ingest = f.dependencies.ingestion.ingestRange;
		let failed = false;
		f.dependencies.ingestion.ingestRange = async (...args) => {
			if (!failed) {
				failed = true;
				f.selected.push(args[1]);
				throw new Error('partial commit');
			}
			return ingest(...args);
		};
		await run(f.config, f.dependencies);
		expect(f.selected.map(r => r.startSequence)).toEqual([900, 900, 1000, 1064, 1128, 3]);
		expect(f.calls.indexOf('ingest')).toBeLessThan(f.calls.indexOf('frontier'));
		expect(f.events.filter(e => e.event === 'priority-processed')).toHaveLength(4);
		expect(f.pending).toBeNull();
	});

	it('resumes pending historical work before selecting new current work', async () => {
		const f = fixture(1);
		f.pending = plan('historical', 3);
		await run(f.config, f.dependencies);
		expect(f.selected).toEqual([range(3, 66)]);
		expect(f.calls).not.toContain('frontier');
		expect(f.calls).not.toContain('priority');
		expect(f.calls).toContain('admit-history');
	});

	it('errors do not erase a due historical offer', async () => {
		const f = fixture(6);
		const historical = f.dependencies.priorityRangeReader.readNextHistoricalRange;
		let failed = false;
		f.dependencies.priorityRangeReader.readNextHistoricalRange = async options => {
			if (!failed) { failed = true; throw new Error('historical lookup failed'); }
			return historical(options);
		};
		await run(f.config, f.dependencies);
		expect(f.selected.map(r => r.startSequence)).toEqual([1000, 1064, 1128, 1192, 1256, 3]);
		expect(f.events.filter(e => e.event === 'cycle-error')).toHaveLength(1);
		expect(f.dependencies.ingestion.prepare).toHaveBeenCalledTimes(2);
	});

	it('a persistently failing unrecorded historical offer does not starve current work', async () => {
		const f = fixture(7);
		f.dependencies.priorityRangeReader.readNextHistoricalRange = async () => {
			f.calls.push('historical-error');
			throw new Error('Historical gap cannot contain a minimum-sized source shard');
		};
		await run(f.config, f.dependencies);
		expect(f.selected.map(r => r.startSequence)).toEqual([1000, 1064, 1128, 1192, 1256, 1320, 1384]);
		expect(f.events.filter(e => e.event === 'cycle-error')).toHaveLength(3);
		expect(f.calls.filter(c => c === 'wait-30')).toHaveLength(3);
		const offer = f.calls.indexOf('historical-error');
		expect(f.calls.slice(offer, offer + 4)).toEqual(['historical-error', 'wait-30', 'admit-current', 'priority']);
		expect(f.events.every(e => e.event !== 'processed')).toBe(true);
		expect(f.pending).toBeNull();
	});

	it('null historical selection does not erase a due historical offer', async () => {
		const f = fixture(6);
		const historical = f.dependencies.priorityRangeReader.readNextHistoricalRange;
		let reads = 0;
		f.dependencies.priorityRangeReader.readNextHistoricalRange = async options =>
			++reads === 1 ? null : historical(options);
		await run(f.config, f.dependencies);
		expect(reads).toBe(2);
		expect(f.selected.map(r => r.startSequence)).toEqual([1000, 1064, 1128, 1192, 1256, 3]);
	});

	it('reads source frontier before selecting current work without advancing genesis', async () => {
		const f = fixture(1);
		await run(f.config, f.dependencies);
		expect(f.calls.indexOf('frontier')).toBeLessThan(f.calls.indexOf('priority'));
		expect(f.events).toContainEqual(expect.objectContaining({
			event: 'priority-processed', nextLedger: 3, startLedger: 1000
		}));
	});

	it('clips bounded replay and completes without priority selection', async () => {
		const f = fixture(100);
		f.config = { ...f.config, prioritizeCurrent: false, lastAvailableLedger: 66 };
		await run(f.config, f.dependencies);
		expect(f.selected).toEqual([range(3, 66)]);
		expect(f.calls).not.toContain('priority');
		expect(f.calls.filter(c => c === 'frontier')).toHaveLength(1);
		expect(f.events).toContainEqual(expect.objectContaining({ event: 'complete', nextLedger: 67 }));
	});

	it('does not contact source for already-complete bounded replay', async () => {
		const f = fixture(100);
		f.config = { ...f.config, prioritizeCurrent: false, lastAvailableLedger: 66 };
		f.dependencies.ingestion.prepare = jest.fn(async () => context(67));
		await run(f.config, f.dependencies);
		expect(f.selected).toEqual([]);
		expect(f.calls).not.toContain('frontier');
	});

	it('storage failure cannot write a pending plan or start ingestion', async () => {
		const f = fixture(1);
		f.dependencies.ensureStorageCapacity = async () => { throw new Error('disk full'); };
		f.dependencies.wait = async () => { f.controller.abort(); };
		await run(f.config, f.dependencies);
		expect(f.selected).toEqual([]);
		expect(f.pending).toBeNull();
		expect(f.calls).not.toContain('pending-write');
		expect(f.events).toContainEqual(expect.objectContaining({ event: 'cycle-error', message: 'Error: disk full' }));
	});

	it('uses the finite current window without historical offers and passes the exact plan to capacity admission', async () => {
		const f = fixture(7);
		f.config = { ...f.config, currentCapacityAllowance: allowance() };
		const plans: PendingPlan[] = [];
		f.dependencies.ensureStorageCapacity = async pending => { plans.push(pending); };
		await run(f.config, f.dependencies);
		expect(f.selected).toHaveLength(7);
		expect(f.calls).not.toContain('historical');
		expect(plans.map(p => [p.kind, p.startLedger, p.endLedger])).toEqual(
			f.selected.map(r => ['priority', r.startSequence, r.endSequence]));
	});

	it.each([plan('historical', 3), plan('priority', 900)])(
		'preserves and refuses a non-current pending plan during the window', async pending => {
			const f = fixture(1);
			f.pending = pending;
			f.config = { ...f.config, currentCapacityAllowance: allowance() };
			f.dependencies.wait = async () => { f.controller.abort(); };
			await run(f.config, f.dependencies);
			expect(f.selected).toEqual([]);
			expect(f.pending).toBe(pending);
			expect(f.calls).not.toContain('pending-write');
		});

	it('idles without a historical fallback while the current window has no work', async () => {
		const f = fixture(1);
		f.config = { ...f.config, currentCapacityAllowance: allowance() };
		f.dependencies.priorityRangeReader.readNextRange = async options => {
			expect(options.minimumPriorityLedger).toBe(1000);
			return null;
		};
		f.dependencies.wait = async () => { f.controller.abort(); };
		await run(f.config, f.dependencies);
		expect(f.calls).not.toContain('historical');
		expect(f.selected).toEqual([]);
	});

	it('restores ordinary historical fairness at the exact expiry boundary', async () => {
		const f = fixture(5);
		f.config = { ...f.config, currentCapacityAllowance: allowance() };
		f.dependencies.now = () => f.selected.length >= 4 ? 2000 : 1000;
		await run(f.config, f.dependencies);
		expect(f.selected.map(r => r.startSequence)).toEqual([1000, 1064, 1128, 1192, 3]);
	});

	it.each([65, 66])('retains 64-ledger historical minimum at source head %i', async head => {
		const f = fixture(1);
		f.dependencies.frontier.readLatestRange = async () => range(head, head);
		f.dependencies.priorityRangeReader.readNextRange = async () => null;
		f.dependencies.wait = async () => { f.controller.abort(); };
		await run(f.config, f.dependencies);
		expect(f.selected).toEqual(head === 66 ? [range(3, 66)] : []);
	});
});

function allowance() {
	return { minimumLedger: 1000, maximumReserveBorrowBytes: 512n * 1024n ** 3n,
		expiresAtMilliseconds: 2000 };
}

type Dependencies = { -readonly [K in keyof ContinuousFullHistoryLedgerCloseMetaLoopDependencies]:
	ContinuousFullHistoryLedgerCloseMetaLoopDependencies[K] };

function fixture(stopAfter: number) {
	const controller = new AbortController();
	const selected: FullHistoryLedgerCloseMetaRange[] = [];
	const events: ContinuousFullHistoryLedgerCloseMetaEvent[] = [];
	const calls: string[] = [];
	let priorityReads = 0;
	let durableNextLedger = 3;
	const f = {
		controller, selected, events, calls, pending: null as PendingPlan | null,
		config: {
			admissionRetryMilliseconds: 10, cycleCooldownMilliseconds: 0,
			cycleLedgerCount: 64, errorBackoffMilliseconds: 30, idlePollMilliseconds: 20,
			lastAvailableLedger: null, prioritizeCurrent: true, typedShardLedgerCount: 64
		} as ContinuousFullHistoryLedgerCloseMetaLoopConfig,
		dependencies: {} as Dependencies
	};
	const historical = new TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader({
		query: async <T>() => [] as T
	});
	f.dependencies = {
		admitCycle: async current => {
			calls.push(current ? 'admit-current' : 'admit-history');
			return { admitted: true };
		},
		emit: event => events.push(event),
		ensureStorageCapacity: async () => { calls.push('capacity'); },
		formatError: String,
		frontier: { readLatestRange: async () => { calls.push('frontier'); return range(10000, 10000); } },
		ingestion: {
			prepare: jest.fn(async () => context(durableNextLedger)),
			ingestRange: async (_context, selectedRange) => {
				calls.push('ingest');
				selected.push(selectedRange);
				if (selected.length >= stopAfter) controller.abort();
				if (selectedRange.startSequence < 100) durableNextLedger = selectedRange.endSequence + 1;
				return receipt(selectedRange, durableNextLedger);
			}
		},
		now: () => 1000,
		pendingPlans: {
			read: async () => f.pending,
			write: async pending => { calls.push('pending-write'); f.pending = pending; },
			clear: async () => { f.pending = null; }
		},
		priorityRangeReader: {
			readNextRange: async () => {
				calls.push('priority');
				const start = 1000 + priorityReads++ * 64;
				return range(start, start + 63);
			},
			readNextHistoricalRange: async options => {
				calls.push('historical');
				return historical.readNextHistoricalRange(options);
			}
		},
		signal: controller.signal,
		wait: async ms => {
			calls.push(`wait-${ms}`);
			if (calls.length > 2000) {
				controller.abort();
				const error = events.filter(event => event.event === 'cycle-error').at(-1);
				throw new Error(`Fixture exceeded 2000 calls: ${error?.message ?? calls.slice(-10).join(', ')}`);
			}
		}
	};
	return f;
}

function receipt(selected: FullHistoryLedgerCloseMetaRange, nextLedger: number) {
	return {
		committedBatches: [{ batchId: 'batch', nextLedger, replayed: false, watermarkVersion: 1 }],
		endLedger: selected.endSequence, ledgerCount: selected.ledgerCount,
		sourceObjectCount: selected.ledgerCount, startLedger: selected.startSequence
	};
}

function context(nextLedger = 3): FullHistoryLedgerCloseMetaIngestionContext {
	return {
		config: { batchesPerPartition: 64000, compression: 'zstd', ledgersPerBatch: 1,
			networkPassphrase: 'Public Global Stellar Network ; September 2015', version: '1.0' },
		registeredSource: { configDigest: digest('11'.repeat(32)), firstAvailableLedger: range(3, 3).startSequence,
			networkPassphraseHash: digest('22'.repeat(32)), nextLedger, sourceId: 'source', watermarkVersion: 0 }
	};
}

function plan(kind: PendingPlan['kind'], startLedger: number): PendingPlan {
	const registered = context().registeredSource;
	return {
		version: 1, kind, networkPassphraseHash: registered.networkPassphraseHash,
		sourceId: registered.sourceId, configDigest: registered.configDigest,
		partitionVersion: 'source-aligned-remainder-v1', sourceBatchLedgerCount: 1,
		typedShardLedgerCount: 64, startLedger, endLedger: startLedger + 63,
		shards: [{ startLedger, endLedger: startLedger + 63 }]
	};
}

function denial() {
	return {
		admitted: false as const, reasons: ['io-full-pressure' as const],
		snapshot: { databaseConnectionBasisPoints: 0, databaseProbeMilliseconds: 0,
			ioFullPressureBasisPoints: 100, ioSomePressureBasisPoints: 100,
			md0InflightRequests: 0, recoveryHealthySamples: 0, recoveryHealthySamplesRequired: 1 }
	};
}
