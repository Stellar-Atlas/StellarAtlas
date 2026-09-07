import { mock } from 'jest-mock-extended';
import {
	queryHubbleLedgerCoverage,
	isHubbleLedgerWindowComplete,
	summarizeHubbleLedgerCoverage
} from '../HubbleLedgerCoverage.js';
import type { HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';

describe('completed Hubble manifest coverage', () => {
	it('does not call a modern supplemental batch continuous coverage', () => {
		expect(
			summarizeHubbleLedgerCoverage([
				{ start_ledger: 2, end_ledger: 1025 },
				{ start_ledger: 1026, end_ledger: 2049 },
				{ start_ledger: 63_490_179, end_ledger: 63_491_202 }
			])
		).toEqual({
			completedRanges: [
				{ firstLedger: '2', lastLedger: '2049' },
				{ firstLedger: '63490179', lastLedger: '63491202' }
			],
			contiguousFirstLedger: '2',
			contiguousLastLedger: '2049',
			contiguousLedgerCount: '2048',
			supplementalLedgerCount: '1024',
			totalLedgerCount: '3072',
			nextLedger: '2050',
			minimumLedger: '2',
			maximumLedger: '63491202',
			gapCount: 1
		});
	});
	it('recognizes a completed supplemental window without filling historical gaps', () => {
		const coverage = summarizeHubbleLedgerCoverage([
			{ start_ledger: 2, end_ledger: 10 },
			{ start_ledger: 100, end_ledger: 110 },
			{ start_ledger: 109, end_ledger: 120 },
			{ start_ledger: 121, end_ledger: 125 }
		]);
		expect(isHubbleLedgerWindowComplete(coverage, 100, 125)).toBe(true);
		expect(isHubbleLedgerWindowComplete(coverage, 3, 8)).toBe(true);
		for (const [first, last] of [
			[99, 100],
			[120, 126],
			[10, 100],
			[11, 12]
		])
			expect(isHubbleLedgerWindowComplete(coverage, first!, last!)).toBe(false);
		expect(coverage.contiguousLastLedger).toBe('10');
		expect(coverage.gapCount).toBe(1);
		expect(coverage.completedRanges).toHaveLength(2);
	});
	it('uses only known continuous bounds when optional intervals are absent', () => {
		const { completedRanges: _ranges, ...legacy } =
			summarizeHubbleLedgerCoverage([
				{ start_ledger: 2, end_ledger: 10 },
				{ start_ledger: 100, end_ledger: 120 }
			]);
		expect(isHubbleLedgerWindowComplete(legacy, 2, 10)).toBe(true);
		expect(isHubbleLedgerWindowComplete(legacy, 100, 120)).toBe(false);
		expect(
			isHubbleLedgerWindowComplete(summarizeHubbleLedgerCoverage([]), 2, 2)
		).toBe(false);
	});

	it('unions duplicate, overlapping and out-of-order ranges without counting ledgers twice', () => {
		expect(
			summarizeHubbleLedgerCoverage([
				{ start_ledger: '5', end_ledger: '9' },
				{ start_ledger: '2', end_ledger: '6' },
				{ start_ledger: '2', end_ledger: '6' },
				{ start_ledger: '10', end_ledger: '15' }
			])
		).toMatchObject({
			contiguousLastLedger: '15',
			totalLedgerCount: '14',
			supplementalLedgerCount: '0',
			gapCount: 0
		});
	});

	it('reports a missing beginning and empty manifests truthfully', () => {
		expect(
			summarizeHubbleLedgerCoverage([{ start_ledger: 100, end_ledger: 109 }])
		).toMatchObject({
			contiguousFirstLedger: null,
			contiguousLastLedger: null,
			contiguousLedgerCount: '0',
			supplementalLedgerCount: '10',
			nextLedger: '2',
			gapCount: 1
		});
		expect(summarizeHubbleLedgerCoverage([])).toMatchObject({
			maximumLedger: null,
			nextLedger: '2',
			totalLedgerCount: '0',
			gapCount: 0
		});
	});

	it('rejects corrupt range bounds', () => {
		expect(() =>
			summarizeHubbleLedgerCoverage([{ start_ledger: 10, end_ledger: 2 }])
		).toThrow('Reversed');
		expect(() =>
			summarizeHubbleLedgerCoverage([
				{ start_ledger: 'garbage', end_ledger: 2 }
			])
		).toThrow('Invalid');
	});

	it('reads only latest completed manifest ranges, never fact tables', async () => {
		const executor = mock<HubbleSemanticQueryExecutor>({
			database: 'stellar_hubble_v2',
			maximumRows: 200
		});
		executor.execute.mockResolvedValue({
			data: [{ ranges: [[2, 1025]], range_count: '1' }]
		});
		const result = await queryHubbleLedgerCoverage(executor);
		expect(result.contiguousLastLedger).toBe('1025');
		expect(executor.execute).toHaveBeenCalledTimes(1);
		const [sql] = executor.execute.mock.calls[0]!;
		expect(sql).toContain(
			'argMax(tuple(status,start_ledger,end_ledger),updated_at)'
		);
		expect(sql).toContain('FROM `stellar_hubble_v2`._ingestion_batches');
		expect(sql).toContain("WHERE tupleElement(latest,1) = 'complete'");
		expect(sql).not.toContain('history_ledgers');
		expect(sql).toContain('groupArray(100001)');
		expect(sql).toContain('count() AS range_count');
	});

	it('rejects bounded aggregate truncation instead of inventing complete coverage', async () => {
		const executor = mock<HubbleSemanticQueryExecutor>({
			database: 'stellar_hubble_v2',
			maximumRows: 200
		});
		executor.execute.mockResolvedValue({
			data: [{ ranges: [], range_count: '100001' }]
		});
		await expect(queryHubbleLedgerCoverage(executor)).rejects.toThrow(
			'read bound'
		);
		executor.execute.mockResolvedValue({
			data: [{ ranges: [], range_count: '1' }]
		});
		await expect(queryHubbleLedgerCoverage(executor)).rejects.toThrow(
			'Incomplete'
		);
		executor.execute.mockResolvedValue({
			data: [{ ranges: [], range_count: '0' }]
		});
		await expect(queryHubbleLedgerCoverage(executor)).resolves.toMatchObject({
			totalLedgerCount: '0'
		});
	});
});
