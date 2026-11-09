import {
	assertPairedCapacity,
	matchesFullPublication,
	type PairedCurrentAdmissionPolicy,
	type PairedFilesystem
} from '../FullHistoryPairedCurrentAdmission.js';

describe('paired current source admission', () => {
	const policy: PairedCurrentAdmissionPolicy = {
		bootId: 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd',
		warehouseReportedPath: '/bulk/warehouse',
		warehouseMetadataPath: '/run/warehouse-metadata',
		warehouseMetadataInode: 12n,
		minimumUnreservedBytes: 800n
	};
	const config = { bulkRoot: '/bulk', typedOutputRoot: '/bulk/source',
		currentMinimumFreeBytes: 500n, minimumFreeBasisPoints: 500, sourceOutputBytes: 100n };
	const before: PairedFilesystem = { device: 4n, inode: 1n, total: 10_000n, available: 1_001n };
	const warehouse = { ...before, inode: 12n, available: 1_000n };
	const row = { path: '/bulk/warehouse/', total_space: '10000', free_space: '1000', unreserved_space: '800' };

	it('counts existing warehouse reservations once and rejects stale or mismatched capacity', () => {
		expect(() => assertPairedCapacity(policy, config, before, before, before, warehouse, row, 4000))
			.not.toThrow();
		expect(() => assertPairedCapacity(policy, config, before, before, before, warehouse, row, 4001))
			.toThrow(/expired/);
		expect(() => assertPairedCapacity(policy, config, before, before, before, { ...warehouse, device: 5n }, row, 5))
			.toThrow(/mismatch/);
		expect(() => assertPairedCapacity(policy, config, before, before, before, warehouse, {
			...row, path: '/bulk/link/../warehouse'
		}, 5)).toThrow(/mismatch/);
		expect(() => assertPairedCapacity(policy, config, before, { ...before, available: 999n }, before, warehouse, row, 5))
			.toThrow(/reserve refused/);
	});

	it('requires one exact completed manifest with the same source digest, range and all 20 dataset counts', () => {
		const source = { id: '00', digest: 'aa'.repeat(32), start: 100, end: 163 };
		const datasets = {
			account_signers: '0', accounts: '0', claimable_balances: '0', config_settings: '0',
			contract_code: '0', contract_data: '0', history_assets: '0', history_contract_events: '0',
			history_effects: '0', history_ledgers: '64', history_operations: '0', history_trades: '0',
			history_transactions: '0', ledger_transactions: '0', liquidity_pools: '0', offers: '0',
			restored_key: '0', token_transfers: '0', trustlines: '0', ttl: '0'
		};
		const manifest = { id: source.id, digest: source.digest, start_ledger: 100, end_ledger: 163,
			ledger_count: 64, status: 'complete', projection_contract: 'hubble-full20-v1', datasets };
		expect(matchesFullPublication(manifest, source)).toBe(true);
		expect(matchesFullPublication({ ...manifest, digest: 'bb'.repeat(32) }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, end_ledger: 164 }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, status: 'started' }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, datasets: { ...datasets, ttl: undefined } }, source)).toBe(false);
		expect(matchesFullPublication({ ...manifest, datasets: { ...datasets, history_ledgers: '63' } }, source)).toBe(false);
	});
});
