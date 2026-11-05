import type { HubbleAccountBalancePage } from '../HubbleAccountBalanceContracts.js';
import { HubbleAccountBalanceFlights } from '../HubbleAccountBalanceFlights.js';

const page: HubbleAccountBalancePage = {
	account: 'fixture',
	balanceScope: 'native-and-issued',
	balances: [],
	elapsedMilliseconds: 0,
	limit: 25,
	nextCursor: null,
	coverage: {
		contiguousFirstLedger: null,
		contiguousLastLedger: null,
		contiguousLedgerCount: '0',
		supplementalLedgerCount: '0',
		totalLedgerCount: '0',
		nextLedger: '2',
		minimumLedger: null,
		maximumLedger: null,
		gapCount: 0
	},
	watermark: {
		mode: 'latest-ingested-observations',
		catalogGeneratedAt: '2026-11-05T00:00:00Z',
		catalogMaximumLedger: null,
		selectedLedger: null,
		snapshotPinned: false,
		coverageStatus: 'partial_or_unknown',
		balancePrecision: 'source-float64'
	}
};

describe('bounded account-balance flights', () => {
	it('releases disconnected waiters but keeps the shared work and bounds keys and waiters', async () => {
		const flights = new HubbleAccountBalanceFlights();
		let finish!: (value: HubbleAccountBalancePage) => void;
		const workResult = new Promise<HubbleAccountBalancePage>((resolve) => {
			finish = resolve;
		});
		let workCount = 0;
		const work = () => {
			workCount++;
			return workResult;
		};
		const waiting = ['a', 'b', 'c', 'd'].map((key) =>
			flights.run(key, undefined, work)
		);
		await expect(flights.run('e', undefined, work)).rejects.toThrow('capacity');
		const disconnected = Array.from(
			{ length: 31 },
			() => new AbortController()
		);
		const stopped = disconnected.map((controller) =>
			flights.run('a', controller.signal, work).catch((error: unknown) => error)
		);
		await expect(flights.run('a', undefined, work)).rejects.toThrow('waiters');
		for (const controller of disconnected) controller.abort();
		await expect(Promise.all(stopped)).resolves.toEqual(
			disconnected.map(({ signal }) => signal.reason)
		);
		const lateJoin = flights.run('a', undefined, work);
		expect(workCount).toBe(4);
		finish(page);
		await expect(Promise.all([...waiting, lateJoin])).resolves.toEqual(
			Array.from({ length: 5 }, () => page)
		);
		await expect(flights.run('a', undefined, work)).resolves.toBe(page);
		expect(workCount).toBe(4);
	});

	it('expires successes and transient failures without queuing fresh attempts before expiry', async () => {
		let now = 0,
			starts = 0;
		const flights = new HubbleAccountBalanceFlights(() => now);
		const success = async () => {
			starts++;
			return page;
		};
		const failure = async () => {
			starts++;
			throw new Error('bounded warehouse failure');
		};
		await flights.run('ok', undefined, success);
		await expect(flights.run('bad', undefined, failure)).rejects.toThrow(
			'bounded warehouse failure'
		);
		now = 4_999;
		await expect(flights.run('bad', undefined, success)).rejects.toThrow(
			'bounded warehouse failure'
		);
		expect(starts).toBe(2);
		now = 5_000;
		await expect(flights.run('bad', undefined, success)).resolves.toBe(page);
		now = 29_999;
		await flights.run('ok', undefined, success);
		expect(starts).toBe(3);
		now = 30_000;
		await flights.run('ok', undefined, success);
		expect(starts).toBe(4);
	});

	it('does not start work for an already canceled waiter or retain oversized coverage', async () => {
		const flights = new HubbleAccountBalanceFlights();
		const controller = new AbortController();
		controller.abort();
		let starts = 0;
		const oversized = {
			...page,
			coverage: {
				...page.coverage,
				completedRanges: Array.from({ length: 1_025 }, () => ({
					firstLedger: '2',
					lastLedger: '2'
				}))
			}
		};
		const work = async () => {
			starts++;
			return oversized;
		};
		await expect(flights.run('a', controller.signal, work)).rejects.toBe(
			controller.signal.reason
		);
		expect(starts).toBe(0);
		await flights.run('a', undefined, work);
		await flights.run('a', undefined, work);
		expect(starts).toBe(2);
	});
});
