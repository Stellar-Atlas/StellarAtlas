import { mock, type MockProxy } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import { readFullHistoryLedgerCloseMetaCoverage } from '../FullHistoryLedgerCloseMetaCoverage.js';

describe('readFullHistoryLedgerCloseMetaCoverage', () => {
	let dataSource: MockProxy<DataSource>;

	beforeEach(() => {
		dataSource = mock<DataSource>();
	});

	it('maps persisted batch and dataset coverage', async () => {
		dataSource.query
			.mockResolvedValueOnce([
				{
					batchCount: 2,
					firstAvailableLedger: '3',
					firstLedger: '3',
					lastLedger: '130',
					ledgerCount: '128',
					nextLedger: '131',
					sourceCount: 1,
					updatedAt: new Date('2026-07-15T12:00:00.000Z')
				}
			])
			.mockResolvedValueOnce([
				{
					batchCount: 2,
					dataset: 'transactions',
					outputBytes: '4096',
					recordCount: '250',
					schemaVersions: ['3']
				}
			]);

		await expect(
			readFullHistoryLedgerCloseMetaCoverage(dataSource, 'Public network')
		).resolves.toEqual({
			batchCount: 2,
			firstAvailableLedger: '3',
			firstLedger: '3',
			lastLedger: '130',
			ledgerCount: '128',
			nextLedger: '131',
			outputs: [
				{
					batchCount: 2,
					dataset: 'transactions',
					outputBytes: '4096',
					recordCount: '250',
					schemaVersions: ['3']
				}
			],
			sourceCount: 1,
			updatedAt: '2026-07-15T12:00:00.000Z'
		});
		for (const call of dataSource.query.mock.calls) {
			expect(call[1]?.[0]).toBeInstanceOf(Buffer);
			expect((call[1]?.[0] as Buffer).byteLength).toBe(32);
		}
	});

	it('returns null before a watermark exists', async () => {
		dataSource.query.mockResolvedValue([]);

		await expect(
			readFullHistoryLedgerCloseMetaCoverage(dataSource, 'Public network')
		).resolves.toBeNull();
	});
});
