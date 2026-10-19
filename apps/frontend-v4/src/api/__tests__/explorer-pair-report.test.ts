import {
	loadPairReport,
	pairReportApiPath,
	validatePairReportSelection,
	type PairReportSelection
} from '../explorer-pair-report';

const assetA = `USD:G${'A'.repeat(55)}`;
const assetB = `EUR:G${'B'.repeat(55)}`;

function selection(
	overrides: Partial<PairReportSelection> = {}
): PairReportSelection {
	return {
		assetA,
		assetB,
		limit: '25',
		...overrides
	};
}

function page(minLedger: number, maxLedger: number, entity: string) {
	return {
		entity,
		rows: [],
		limit: 25,
		offset: 0,
		nextOffset: null,
		window: { minLedger, maxLedger },
		coverage: {},
		coverageStatus: 'partial',
		semantics: 'historical observations'
	};
}

describe('explorer pair report API helper', () => {
	it('builds correctly oriented typed trade and historical pool paths', () => {
		const selected = selection({ minLedger: '100', maxLedger: '120' });
		const tradeReverse = new URL(
			pairReportApiPath(selected, 'b-to-a', 50),
			'https://example.test'
		);
		const poolReverse = new URL(
			pairReportApiPath(selected, 'pool-b-a'),
			'https://example.test'
		);

		expect(tradeReverse.pathname).toBe('/v1/trades');
		expect(tradeReverse.searchParams.get('selling_asset')).toBe(assetB);
		expect(tradeReverse.searchParams.get('buying_asset')).toBe(assetA);
		expect(tradeReverse.searchParams.get('view')).toBe('typed');
		expect(tradeReverse.searchParams.get('offset')).toBe('50');
		expect(poolReverse.pathname).toBe('/v1/analytics/liquidity-pools');
		expect(poolReverse.searchParams.get('asset_a')).toBe(assetB);
		expect(poolReverse.searchParams.get('asset_b')).toBe(assetA);
		expect(poolReverse.searchParams.get('min_ledger')).toBe('100');
		expect(poolReverse.searchParams.get('max_ledger')).toBe('120');
		expect(poolReverse.searchParams.has('include_deleted')).toBe(false);
	});

	it('pins all follow-up pages to the first returned window with at most two concurrent requests', async () => {
		const requests: string[] = [];
		let active = 0;
		let maxActive = 0;
		const requestJson = async (path: string) => {
			requests.push(path);
			active++;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active--;
			const entity = new URL(path, 'https://example.test').pathname.endsWith(
				'/trades'
			)
				? 'trades'
				: 'liquidity-pools';
			return page(500, 520, entity);
		};

		const result = await loadPairReport(
			selection(),
			new AbortController().signal,
			requestJson
		);
		expect(result.selection.minLedger).toBe('500');
		expect(result.selection.maxLedger).toBe('520');
		expect(Object.keys(result.pages)).toEqual([
			'a-to-b',
			'b-to-a',
			'pool-a-b',
			'pool-b-a'
		]);
		expect(maxActive).toBeLessThanOrEqual(2);
		expect(requests).toHaveLength(4);
		for (const path of requests.slice(1)) {
			const url = new URL(path, 'https://example.test');
			expect(url.searchParams.get('min_ledger')).toBe('500');
			expect(url.searchParams.get('max_ledger')).toBe('520');
		}
	});

	it('normalizes native assets and rejects invalid identities or ledger selections', () => {
		expect(
			validatePairReportSelection(selection({ assetA: 'XlM' })).assetA
		).toBe('native');
		expect(() =>
			validatePairReportSelection(selection({ assetA: assetB }))
		).toThrow('distinct assets');
		expect(() =>
			validatePairReportSelection(selection({ minLedger: '2' }))
		).toThrow('both ledger bounds');
		expect(() =>
			validatePairReportSelection(
				selection({ minLedger: '2', maxLedger: '2050' })
			)
		).toThrow('at most 2,048');
		expect(() =>
			validatePairReportSelection(selection({ limit: '5' }))
		).toThrow('Limit must be');
	});

	it('does not start the next request after cancellation', async () => {
		const controller = new AbortController();
		let calls = 0;
		const requestJson = async () => {
			calls++;
			controller.abort(new Error('cancelled'));
			return page(500, 520, 'trades');
		};

		await expect(
			loadPairReport(selection(), controller.signal, requestJson)
		).rejects.toThrow('cancelled');
		expect(calls).toBe(1);
	});
});
