import { mock, type MockProxy } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import {
	explorerLocalTrustlineChangesSql,
	GetExplorerLocalTrustlineChanges,
	validateExplorerLocalTrustlineChangesQuery
} from '../GetExplorerLocalTrustlineChanges.js';
import {
	trustlineAccountId,
	trustlineAssetIssuer,
	trustlineObservationRow
} from './ExplorerLocalTrustlineChangeTestFixture.js';

describe('GetExplorerLocalTrustlineChanges', () => {
	let dataSource: MockProxy<DataSource>;
	let useCase: GetExplorerLocalTrustlineChanges;

	beforeEach(() => {
		dataSource = mock<DataSource>();
		useCase = new GetExplorerLocalTrustlineChanges(dataSource, {
			networkPassphrase: 'Test SDF Network ; September 2015'
		});
	});

	it('returns newest-first bounded Alpha4 observations with string-safe evidence', async () => {
		dataSource.query.mockResolvedValue([
			trustlineObservationRow(),
			trustlineObservationRow({
				batchId: '00000000-0000-4000-8000-000000000015',
				changeIndex: '1',
				lastModifiedLedger: '63390041',
				ledgerSequence: '63390041',
				transactionIndex: '8'
			})
		]);

		const result = await useCase.execute({
			accountId: trustlineAccountId,
			limit: 1
		});

		expect(result).toMatchObject({
			accountId: trustlineAccountId,
			count: 1,
			coverage: {
				evidenceSelection: 'latest_complete_canonical_lcm_batch',
				range: {
					batchId: '00000000-0000-4000-8000-000000000014',
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
					name: 'trustline-state-changes',
					outputSha256: '2'.repeat(64)
				},
				manifest: { sha256: '4'.repeat(64) },
				proof: { minimumVersion: 6 },
				row: { sha256: '5'.repeat(64) }
			},
			stateSemantics: 'observed_post_change_state',
			trustlineFields: {
				asset: {
					assetType: 1,
					code: 'USD',
					issuer: trustlineAssetIssuer,
					kind: 'credit_alphanum4',
					liquidityPoolId: null
				},
				balance: '9007199254740995',
				buyingLiabilities: '9007199254740996',
				flags: '4294967295',
				limit: '9223372036854775807',
				liquidityPoolUseCount: '0',
				sellingLiabilities: '9007199254740997'
			}
		});

		expect(dataSource.query).toHaveBeenCalledTimes(1);
		const parameters = dataSource.query.mock.calls[0]?.[1];
		expect(parameters?.[0]).toBeInstanceOf(Buffer);
		expect((parameters?.[0] as Buffer).byteLength).toBe(32);
		expect(parameters?.[1]).toBe(trustlineAccountId);
		expect(parameters?.[2]).toBe(2);
	});

	it('maps Alpha12 and liquidity-pool identities without conflating them', async () => {
		dataSource.query.mockResolvedValue([
			trustlineObservationRow({
				assetCode: 'LONGASSET123',
				assetType: 2,
				assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM12'
			}),
			trustlineObservationRow({
				assetCode: null,
				assetIssuer: null,
				assetType: 3,
				assetTypeString: 'ASSET_TYPE_POOL_SHARE',
				liquidityPoolId: 'a'.repeat(64)
			})
		]);

		const result = await useCase.execute({
			accountId: trustlineAccountId,
			limit: 2
		});

		if (result.status !== 'available') throw new Error('expected available');
		expect(
			result.records.map((record) => record.trustlineFields.asset)
		).toEqual([
			{
				assetType: 2,
				assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM12',
				code: 'LONGASSET123',
				issuer: trustlineAssetIssuer,
				kind: 'credit_alphanum12',
				liquidityPoolId: null
			},
			{
				assetType: 3,
				assetTypeString: 'ASSET_TYPE_POOL_SHARE',
				code: null,
				issuer: null,
				kind: 'liquidity_pool_share',
				liquidityPoolId: 'a'.repeat(64)
			}
		]);
	});

	it('labels deleted rows as final pre-deletion state and rejects mismatched evidence', async () => {
		dataSource.query.mockResolvedValueOnce([
			trustlineObservationRow({
				changeType: 2,
				changeTypeString: 'LEDGER_ENTRY_REMOVED',
				deleted: true
			})
		]);

		const result = await useCase.execute({
			accountId: trustlineAccountId,
			limit: 1
		});
		if (result.status !== 'available') throw new Error('expected available');
		expect(result.records[0]).toMatchObject({
			deleted: true,
			stateSemantics: 'final_pre_deletion_state',
			trustlineFields: { balance: '9007199254740995' }
		});

		dataSource.query.mockResolvedValueOnce([
			trustlineObservationRow({ deleted: true })
		]);
		await expect(
			useCase.execute({ accountId: trustlineAccountId, limit: 1 })
		).rejects.toThrow('deletion evidence is inconsistent');
	});

	it('distinguishes no observation from unavailable complete coverage', async () => {
		dataSource.query.mockResolvedValueOnce([
			trustlineObservationRow({ hasObservation: false })
		]);
		await expect(
			useCase.execute({ accountId: trustlineAccountId, limit: 1 })
		).resolves.toMatchObject({
			count: 0,
			reason: 'no_change_observed_in_complete_coverage',
			status: 'not_observed'
		});

		dataSource.query.mockResolvedValueOnce([]);
		await expect(
			useCase.execute({ accountId: trustlineAccountId, limit: 1 })
		).resolves.toMatchObject({
			coverage: null,
			reason: 'complete_canonical_coverage_empty',
			status: 'unavailable'
		});
	});

	it('rejects malformed account, limits, asset identities, and freshness', async () => {
		await expect(
			useCase.execute({
				accountId: `${trustlineAccountId.slice(0, -1)}A`,
				limit: 1
			})
		).rejects.toThrow('valid G-address');
		await expect(
			useCase.execute({ accountId: trustlineAccountId, limit: 26 })
		).rejects.toThrow('between 1 and 25');
		expect(dataSource.query).not.toHaveBeenCalled();

		dataSource.query.mockResolvedValueOnce([
			trustlineObservationRow({ liquidityPoolId: 'a'.repeat(64) })
		]);
		await expect(
			useCase.execute({ accountId: trustlineAccountId, limit: 1 })
		).rejects.toThrow('credit asset identity');

		dataSource.query.mockResolvedValueOnce([
			trustlineObservationRow({
				observationLedgerClosedAt: new Date('2026-07-15T12:00:01.000Z')
			})
		]);
		await expect(
			useCase.execute({ accountId: trustlineAccountId, limit: 1 })
		).rejects.toThrow('close time is inconsistent');
	});

	it('uses complete trustline coverage only and never selects raw state XDR or fallback data', () => {
		expect(explorerLocalTrustlineChangesSql).toContain(
			'complete_coverage as not materialized'
		);
		expect(explorerLocalTrustlineChangesSql).toContain(
			'dataset."dataset" = \'trustline-state-changes\''
		);
		expect(explorerLocalTrustlineChangesSql).toContain(
			'coverage."status" = \'complete\''
		);
		expect(explorerLocalTrustlineChangesSql).toContain(
			'join complete_coverage proof_gate'
		);
		expect(explorerLocalTrustlineChangesSql).toContain(
			'from "full_history_lcm_trustline_state_change" trustline_change'
		);
		expect(explorerLocalTrustlineChangesSql).toContain(
			'trustline_change."ledger_sequence" desc'
		);
		expect(explorerLocalTrustlineChangesSql).not.toContain('state_entry_xdr');
		expect(explorerLocalTrustlineChangesSql).not.toMatch(/horizon|synthetic/iu);
	});
});

describe('validateExplorerLocalTrustlineChangesQuery', () => {
	it('accepts checksum-valid G-addresses and bounded limits only', () => {
		expect(() =>
			validateExplorerLocalTrustlineChangesQuery({
				accountId: trustlineAccountId,
				limit: 25
			})
		).not.toThrow();
		expect(() =>
			validateExplorerLocalTrustlineChangesQuery({
				accountId: trustlineAccountId,
				limit: 0
			})
		).toThrow();
	});
});
