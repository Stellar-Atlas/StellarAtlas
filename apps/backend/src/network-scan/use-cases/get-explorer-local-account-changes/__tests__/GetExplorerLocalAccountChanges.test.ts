import { mock, type MockProxy } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import {
	explorerLocalAccountChangesSql,
	GetExplorerLocalAccountChanges,
	validateExplorerLocalAccountChangesQuery
} from '../GetExplorerLocalAccountChanges.js';
import {
	accountId,
	accountObservationRow
} from './ExplorerLocalAccountChangeTestFixture.js';

describe('GetExplorerLocalAccountChanges', () => {
	let dataSource: MockProxy<DataSource>;
	let useCase: GetExplorerLocalAccountChanges;

	beforeEach(() => {
		dataSource = mock<DataSource>();
		useCase = new GetExplorerLocalAccountChanges(dataSource, {
			networkPassphrase: 'Test SDF Network ; September 2015'
		});
	});

	it('returns the newest bounded proof-gated observation with typed evidence', async () => {
		dataSource.query.mockResolvedValue([
			accountObservationRow(),
			accountObservationRow({
				batchId: '00000000-0000-4000-8000-000000000005',
				changeIndex: '1',
				ledgerSequence: '63390041',
				transactionIndex: '8'
			})
		]);

		const result = await useCase.execute({ accountId, limit: 1 });

		expect(result).toMatchObject({
			accountId,
			count: 1,
			coverage: {
				evidenceSelection: 'latest_complete_canonical_lcm_batch',
				range: {
					batchId: '00000000-0000-4000-8000-000000000004',
					firstLedger: '63390080',
					lastLedger: '63390143',
					ledgerCount: 64
				}
			},
			interpretation: 'historical_observations_not_current_state',
			limit: 1,
			status: 'available',
			truncated: true
		});
		if (result.status !== 'available') throw new Error('expected available');
		expect(result.records[0]).toMatchObject({
			accountFields: {
				accountId,
				balance: '9876543210',
				signers: [
					{ key: 'G-SIGNER-ONE', sponsor: null, weight: 1 },
					{ key: 'G-SIGNER-TWO', sponsor: accountId, weight: 2 }
				]
			},
			change: {
				reason: 'operation',
				transactionHash: '6'.repeat(64)
			},
			deleted: false,
			freshness: { ledgerClosedAt: '2026-07-15T12:00:00.000Z' },
			position: {
				changeIndex: '3',
				ledgerSequence: '63390042',
				transactionIndex: '9'
			},
			provenance: {
				dataset: {
					importedRowSetSha256: '1'.repeat(64),
					name: 'account-state-changes',
					outputSha256: '2'.repeat(64)
				},
				manifest: { sha256: '4'.repeat(64) },
				proof: { minimumVersion: 6 },
				row: { sha256: '5'.repeat(64) }
			},
			stateSemantics: 'observed_post_change_state'
		});

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		const parameters = dataSource.query.mock.calls[0]?.[1];
		expect(parameters?.[0]).toBeInstanceOf(Buffer);
		expect((parameters?.[0] as Buffer).byteLength).toBe(32);
		expect(parameters?.[1]).toBe(accountId);
		expect(parameters?.[2]).toBe(2);
	});

	it('labels deleted observations as final pre-deletion state', async () => {
		dataSource.query.mockResolvedValue([
			accountObservationRow({ deleted: true })
		]);

		const result = await useCase.execute({ accountId, limit: 1 });

		if (result.status !== 'available') throw new Error('expected available');
		expect(result.records[0]).toMatchObject({
			deleted: true,
			stateSemantics: 'final_pre_deletion_state'
		});
	});

	it('reports an empty complete evidence window as not observed, not not found', async () => {
		dataSource.query.mockResolvedValue([
			accountObservationRow({ hasObservation: false })
		]);

		await expect(
			useCase.execute({ accountId, limit: 1 })
		).resolves.toMatchObject({
			count: 0,
			reason: 'no_change_observed_in_complete_coverage',
			records: [],
			status: 'not_observed',
			truncated: false
		});
	});

	it('reports unavailable before any complete canonical LCM coverage exists', async () => {
		dataSource.query.mockResolvedValue([]);

		await expect(
			useCase.execute({ accountId, limit: 1 })
		).resolves.toMatchObject({
			coverage: null,
			reason: 'complete_canonical_coverage_empty',
			status: 'unavailable'
		});
	});

	it('rejects malformed account and limit input before querying', async () => {
		await expect(
			useCase.execute({ accountId: `${accountId.slice(0, -1)}A`, limit: 1 })
		).rejects.toThrow('valid G-address');
		await expect(useCase.execute({ accountId, limit: 26 })).rejects.toThrow(
			'between 1 and 25'
		);
		expect(dataSource.query).not.toHaveBeenCalled();
	});

	it('rejects inconsistent typed signer or ledger freshness evidence', async () => {
		dataSource.query.mockResolvedValueOnce([
			accountObservationRow({ signerCount: '3' })
		]);
		await expect(useCase.execute({ accountId, limit: 1 })).rejects.toThrow(
			'signer arrays'
		);

		dataSource.query.mockResolvedValueOnce([
			accountObservationRow({
				observationLedgerClosedAt: new Date('2026-07-15T12:00:01.000Z')
			})
		]);
		await expect(useCase.execute({ accountId, limit: 1 })).rejects.toThrow(
			'close time is inconsistent'
		);

		dataSource.query.mockResolvedValueOnce([
			accountObservationRow({ coverageLastLedger: '63390078' })
		]);
		await expect(useCase.execute({ accountId, limit: 1 })).rejects.toThrow(
			'coverage range is inconsistent'
		);
	});

	it('uses only complete coverage joins and never selects raw state entry XDR', () => {
		expect(explorerLocalAccountChangesSql).toContain(
			'complete_coverage as not materialized'
		);
		expect(explorerLocalAccountChangesSql).toContain(
			'coverage."status" = \'complete\''
		);
		expect(explorerLocalAccountChangesSql).toContain(
			'join complete_coverage proof_gate'
		);
		expect(explorerLocalAccountChangesSql).toContain(
			'from "full_history_lcm_account_state_change" account_change'
		);
		expect(explorerLocalAccountChangesSql).toContain(
			'account_change."ledger_sequence" desc'
		);
		expect(explorerLocalAccountChangesSql).not.toContain('state_entry_xdr');
	});
});

describe('validateExplorerLocalAccountChangesQuery', () => {
	it('accepts checksum-valid G-addresses and bounded limits only', () => {
		expect(() =>
			validateExplorerLocalAccountChangesQuery({ accountId, limit: 25 })
		).not.toThrow();
		expect(() =>
			validateExplorerLocalAccountChangesQuery({ accountId, limit: 0 })
		).toThrow();
	});
});
