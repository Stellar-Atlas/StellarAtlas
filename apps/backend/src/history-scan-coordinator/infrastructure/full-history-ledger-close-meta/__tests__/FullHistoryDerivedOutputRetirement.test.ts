import { readDerivedOutputRetirements, assertDerivedOutputRecovery } from '../FullHistoryDerivedOutputRetirement.js';
import { TypeOrmRegisteredOutputInventory } from '../TypeOrmRegisteredOutputInventory.js';

const row = {
	batchId: '00000000-0000-4000-8000-000000000001', networkIdSha256: '01'.repeat(32),
	startLedger: 3, endLedger: 66, manifestSha256: '02'.repeat(32), canonicalSha256: '03'.repeat(32),
	dataset: 'transactions', outputSha256: '04'.repeat(32), byteCount: '123', recordCount: '7',
	storageKey: 'network/ledger-close-meta/3-66/transactions.parquet',
	removed: false, evidenceSha256: '05'.repeat(32), transformRevision: '06'.repeat(20)
};
const query = (values: unknown[], available = true) => ({
	query: async (sql: string) => sql.includes('to_regclass') ? [{ available }] : values
});
describe('explicit derived output retirement', () => {
	it('credits only confirmed removal while retaining the canonical directory allowance', async () => {
		const inventory = (removedBytes: string) => new TypeOrmRegisteredOutputInventory({
			createQueryRunner: () => ({
				connect: async () => undefined, startTransaction: async () => undefined,
				commitTransaction: async () => undefined, rollbackTransaction: async () => undefined,
				release: async () => undefined,
				query: async (sql: string) => {
					if (sql.includes('to_regclass')) return [{ available: true }];
					if (sql.includes('as removed_bytes')) {
						expect(sql).toContain('r.removal_confirmed_at is not null');
						return [{ removed_bytes: removedBytes }];
					}
					if (sql.startsWith('SET')) return [];
					return [{ dataset_count: '4', dataset_bytes: '1000', canonical_count: '1', canonical_bytes: '300',
						canonical_rows: [{ storageKey: row.networkIdSha256 + '/ledger-close-meta/3-66/ledger-close-meta.xdr.zst',
							outputBytes: '300', networkHash: row.networkIdSha256 }] }];
				}
			})
		});
		expect((await inventory('0').read()).storedBytes).toBe(1000n + 4n * 1024n * 1024n);
		expect((await inventory('123').read()).storedBytes).toBe(877n + 4n * 1024n * 1024n);
		await expect(inventory('701').read()).rejects.toThrow('Invalid retired residency total');
	});
	it('is inactive without the additive schema and distinguishes retirement from removal', async () => {
		const selection = { batchIds: [row.batchId] };
		expect(await readDerivedOutputRetirements(query([], false), Buffer.alloc(32, 1), selection)).toEqual([]);
		const plans = await readDerivedOutputRetirements(query([row]), Buffer.alloc(32, 1), selection);
		expect(plans[0]?.outputs[0]?.removed).toBe(false);
		expect(Object.isFrozen(plans[0]?.outputs)).toBe(true);
	});
	it('refuses protected datasets and inconsistent canonical identities', async () => {
		const selection = { batchIds: [row.batchId] };
		await expect(readDerivedOutputRetirements(query([{ ...row, dataset: 'ledger-close-meta' }]),
			Buffer.alloc(32, 1), selection)).rejects.toThrow('Dataset cannot be retired');
		await expect(readDerivedOutputRetirements(query([row, { ...row, dataset: 'operations', canonicalSha256: '07'.repeat(32) }]),
			Buffer.alloc(32, 1), selection)).rejects.toThrow('Conflicting retirement identity');
	});
	it('binds removal to the unchanged manifest, canonical replay and original descriptor', async () => {
		const [plan] = await readDerivedOutputRetirements(query([{ ...row, removed: true }]),
			Buffer.alloc(32, 1), { batchIds: [row.batchId] });
		if (!plan) throw new Error('missing test plan');
		const receipt = {
			manifestSha256: row.manifestSha256, range: { startSequence: 3, endSequence: 66 },
			outputs: [{ dataset: 'ledger-close-meta', sha256: row.canonicalSha256 },
				{ dataset: row.dataset, sha256: row.outputSha256, byteCount: 123, recordCount: 7,
					storageKey: row.storageKey, representation: 'typed-projection' }]
		} as unknown as Parameters<typeof assertDerivedOutputRecovery>[1];
		expect(() => assertDerivedOutputRecovery(plan, receipt, row.networkIdSha256)).not.toThrow();
		expect(() => assertDerivedOutputRecovery({ ...plan, manifestSha256: '09'.repeat(32) },
			receipt, row.networkIdSha256)).toThrow('Retirement recovery identity mismatch');
	});
});
