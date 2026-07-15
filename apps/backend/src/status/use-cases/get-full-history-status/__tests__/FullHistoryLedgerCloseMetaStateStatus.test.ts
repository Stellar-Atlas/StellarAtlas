import { mock, type MockProxy } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import { readFullHistoryLedgerCloseMetaStateStatus } from '../FullHistoryLedgerCloseMetaStateStatus.js';

describe('readFullHistoryLedgerCloseMetaStateStatus', () => {
	let dataSource: MockProxy<DataSource>;

	beforeEach(() => {
		dataSource = mock<DataSource>();
	});

	it('maps bounded lifecycle aggregates by dataset and canonical linkage', async () => {
		dataSource.query
			.mockResolvedValueOnce([
				{
					complete: '1',
					dataset: 'account-state-changes',
					failed: '1',
					importing: '1',
					latestCompletedAt: new Date('2026-07-15T11:57:00.000Z'),
					latestUpdatedAt: new Date('2026-07-15T11:59:00.000Z'),
					pending: '1',
					total: '4'
				},
				{
					complete: '2',
					dataset: 'trustline-state-changes',
					failed: '0',
					importing: '0',
					latestCompletedAt: '2026-07-15T11:58:00.000Z',
					latestUpdatedAt: '2026-07-15T11:58:30.000Z',
					pending: '0',
					total: '2'
				}
			])
			.mockResolvedValueOnce([
				{
					checking: '1',
					complete: '2',
					expectedLedgerCount: '320',
					failed: '1',
					latestCompletedAt: '2026-07-15T11:56:00.000Z',
					latestUpdatedAt: '2026-07-15T11:59:30.000Z',
					matchedLedgerCount: '192',
					pending: '1',
					total: '5'
				}
			]);

		await expect(
			readFullHistoryLedgerCloseMetaStateStatus(dataSource, 'Public network')
		).resolves.toEqual({
			canonicalLinkage: {
				expectedLedgerCount: '320',
				latestCompletedAt: '2026-07-15T11:56:00.000Z',
				latestUpdatedAt: '2026-07-15T11:59:30.000Z',
				lifecycle: {
					checking: 1,
					complete: 2,
					failed: 1,
					pending: 1,
					total: 5
				},
				matchedLedgerCount: '192'
			},
			imports: {
				datasets: [
					{
						dataset: 'account-state-changes',
						latestCompletedAt: '2026-07-15T11:57:00.000Z',
						latestUpdatedAt: '2026-07-15T11:59:00.000Z',
						lifecycle: {
							complete: 1,
							failed: 1,
							importing: 1,
							pending: 1,
							total: 4
						}
					},
					{
						dataset: 'trustline-state-changes',
						latestCompletedAt: '2026-07-15T11:58:00.000Z',
						latestUpdatedAt: '2026-07-15T11:58:30.000Z',
						lifecycle: {
							complete: 2,
							failed: 0,
							importing: 0,
							pending: 0,
							total: 2
						}
					}
				],
				latestCompletedAt: '2026-07-15T11:58:00.000Z',
				latestUpdatedAt: '2026-07-15T11:59:00.000Z',
				lifecycle: {
					complete: 3,
					failed: 1,
					importing: 1,
					pending: 1,
					total: 6
				}
			}
		});
		expect(dataSource.query).toHaveBeenCalledTimes(2);
		expect(dataSource.query.mock.calls[0]?.[0]).toContain(
			'full_history_lcm_state_import'
		);
		expect(dataSource.query.mock.calls[1]?.[0]).toContain(
			'full_history_lcm_state_canonical_coverage'
		);
		for (const call of dataSource.query.mock.calls) {
			expect(call[1]).toHaveLength(1);
			expect(call[1]?.[0]).toBeInstanceOf(Buffer);
			expect((call[1]?.[0] as Buffer).byteLength).toBe(32);
		}
	});

	it('returns explicit zero counts before imports are registered', async () => {
		dataSource.query.mockResolvedValue([]);

		await expect(
			readFullHistoryLedgerCloseMetaStateStatus(dataSource, 'Public network')
		).resolves.toMatchObject({
			canonicalLinkage: {
				expectedLedgerCount: '0',
				latestCompletedAt: null,
				latestUpdatedAt: null,
				lifecycle: {
					checking: 0,
					complete: 0,
					failed: 0,
					pending: 0,
					total: 0
				},
				matchedLedgerCount: '0'
			},
			imports: {
				datasets: [
					{ dataset: 'account-state-changes' },
					{ dataset: 'trustline-state-changes' }
				],
				lifecycle: {
					complete: 0,
					failed: 0,
					importing: 0,
					pending: 0,
					total: 0
				}
			}
		});
	});

	it('rejects lifecycle aggregates that omit an unknown persisted status', async () => {
		dataSource.query
			.mockResolvedValueOnce([
				{
					complete: '0',
					dataset: 'account-state-changes',
					failed: '0',
					importing: '0',
					latestCompletedAt: null,
					latestUpdatedAt: '2026-07-15T12:00:00.000Z',
					pending: '1',
					total: '2'
				}
			])
			.mockResolvedValueOnce([]);

		await expect(
			readFullHistoryLedgerCloseMetaStateStatus(dataSource, 'Public network')
		).rejects.toThrow('state import lifecycle counts are incomplete');
	});

	it('rejects unknown datasets and impossible canonical ledger counts', async () => {
		dataSource.query
			.mockResolvedValueOnce([
				{
					complete: '0',
					dataset: 'contract-state-changes',
					failed: '0',
					importing: '0',
					latestCompletedAt: null,
					latestUpdatedAt: '2026-07-15T12:00:00.000Z',
					pending: '1',
					total: '1'
				}
			])
			.mockResolvedValueOnce([]);

		await expect(
			readFullHistoryLedgerCloseMetaStateStatus(dataSource, 'Public network')
		).rejects.toThrow('Unknown state import dataset');

		dataSource.query.mockReset();
		dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				checking: '0',
				complete: '1',
				expectedLedgerCount: '64',
				failed: '0',
				latestCompletedAt: '2026-07-15T12:00:00.000Z',
				latestUpdatedAt: '2026-07-15T12:00:00.000Z',
				matchedLedgerCount: '65',
				pending: '0',
				total: '1'
			}
		]);

		await expect(
			readFullHistoryLedgerCloseMetaStateStatus(dataSource, 'Public network')
		).rejects.toThrow('Canonical linkage matched ledger count is invalid');

		dataSource.query.mockReset();
		dataSource.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
			{
				checking: '0',
				complete: '1',
				expectedLedgerCount: '64',
				failed: '0',
				latestCompletedAt: '2026-07-15T12:00:00.000Z',
				latestUpdatedAt: '2026-07-15T12:00:00.000Z',
				matchedLedgerCount: '63',
				pending: '0',
				total: '1'
			}
		]);

		await expect(
			readFullHistoryLedgerCloseMetaStateStatus(dataSource, 'Public network')
		).rejects.toThrow('Completed canonical linkage is not fully matched');
	});
});
