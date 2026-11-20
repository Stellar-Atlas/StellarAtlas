import { readDerivedOutputRetirements, assertDerivedOutputRecovery, type DerivedOutputRecovery } from '../FullHistoryDerivedOutputRetirement.js';
import { TypeOrmRegisteredOutputInventory } from '../TypeOrmRegisteredOutputInventory.js';

const row = {
	batchId: '00000000-0000-4000-8000-000000000001', networkIdSha256: '01'.repeat(32),
	startLedger: 3, endLedger: 66, manifestSha256: '02'.repeat(32), canonicalSha256: '03'.repeat(32),
	dataset: 'transactions', outputSha256: '04'.repeat(32), byteCount: '123', recordCount: '7',
	storageKey: 'network/ledger-close-meta/3-66/transactions.parquet',
	removed: false, evidenceSha256: '05'.repeat(32), transformRevision: '06'.repeat(20),
	namespaceRemovedColumn: false, namespaceIntentColumn: false,
	namespaceRemoved: false, namespaceIntentSha256: null
};
const query = (values: unknown[], available = true) => ({
	query: async (sql: string) => sql.includes('to_regclass') ? [{ available }] : values
});
describe('explicit derived output retirement', () => {
	it('credits only confirmed removal while retaining the canonical directory allowance', async () => {
		const inventory = (removedBytes: string, namespaceOnly = false) => new TypeOrmRegisteredOutputInventory({
			createQueryRunner: () => ({
				connect: async () => undefined, startTransaction: async () => undefined,
				commitTransaction: async () => undefined, rollbackTransaction: async () => undefined,
				release: async () => undefined,
				query: async (sql: string) => {
					if (sql.includes('to_regclass')) return [{ available: true }];
					if (sql.includes('as removed_bytes')) {
						expect(sql).toContain('r.removal_confirmed_at is not null');
						expect(sql).not.toContain('namespace_removed_at');
						return [{ removed_bytes: removedBytes, namespace_removed_bytes: namespaceOnly ? '123' : '0' }];
					}
					if (sql.startsWith('SET')) return [];
					return [{ dataset_count: '4', dataset_bytes: '1000', canonical_count: '1', canonical_bytes: '300',
						canonical_rows: [{ storageKey: row.networkIdSha256 + '/ledger-close-meta/3-66/ledger-close-meta.xdr.zst',
							outputBytes: '300', networkHash: row.networkIdSha256 }] }];
				}
			})
		});
		expect((await inventory('0').read()).storedBytes).toBe(1000n + 4n * 1024n * 1024n);
		expect((await inventory('0', true).read()).storedBytes).toBe(1000n + 4n * 1024n * 1024n);
		expect((await inventory('123').read()).storedBytes).toBe(877n + 4n * 1024n * 1024n);
		await expect(inventory('701').read()).rejects.toThrow('Invalid retired residency total');
	});
	it('is inactive without the additive schema and distinguishes retirement from removal', async () => {
		const selection = { batchIds: [row.batchId] };
		expect(await readDerivedOutputRetirements(query([], false), Buffer.alloc(32, 1), selection)).toEqual([]);
		const plans = await readDerivedOutputRetirements(query([row]), Buffer.alloc(32, 1), selection);
		expect(plans[0]?.version).toBe(1);
		expect(plans[0]?.outputs[0]?.removed).toBe(false);
		expect(plans[0]?.outputs[0]).not.toHaveProperty('namespaceRemoved');
		expect(plans[0]?.outputs[0]).not.toHaveProperty('namespaceIntentSha256');
		expect(Object.isFrozen(plans[0]?.outputs)).toBe(true);
	});
	it('reads version two without conflating namespace state and legacy physical confirmation', async () => {
		const values = [{ ...row, namespaceRemovedColumn: true, namespaceIntentColumn: true,
			namespaceRemoved: true, namespaceIntentSha256: '08'.repeat(32) }];
		const observedSql: string[] = [];
		const reader = { query: async (sql: string) => {
			observedSql.push(sql);
			return sql.includes('to_regclass') ? [{ available: true }] : values;
		} };
		const [plan] = await readDerivedOutputRetirements(reader, Buffer.alloc(32, 1), { batchIds: [row.batchId] });
		expect(plan?.version).toBe(2);
		expect(plan?.outputs[0]).toMatchObject({ removed: false, namespaceRemoved: true, namespaceIntentSha256: '08'.repeat(32) });
		expect(observedSql[1]).toContain("to_jsonb(r) ? 'namespace_removed_at'");
		expect(observedSql[1]).toContain("to_jsonb(r) ? 'namespace_intent_sha256'");
		expect(observedSql[1]).not.toMatch(/r\.namespace_(removed_at|intent_sha256)/);
		const [legacyPhysical] = await readDerivedOutputRetirements(query([{ ...row,
			namespaceRemovedColumn: true, namespaceIntentColumn: true, removed: true }]),
			Buffer.alloc(32, 1), { batchIds: [row.batchId] });
		expect(legacyPhysical?.outputs[0]).toMatchObject({ removed: true, namespaceRemoved: false, namespaceIntentSha256: null });
	});
	it.each([
		{ namespaceRemovedColumn: true, namespaceIntentColumn: false },
		{ namespaceRemovedColumn: undefined, namespaceIntentColumn: undefined },
		{ namespaceRemovedColumn: true, namespaceIntentColumn: true, namespaceRemoved: true },
		{ namespaceRemovedColumn: true, namespaceIntentColumn: true, namespaceIntentSha256: '08'.repeat(32) },
		{ namespaceRemovedColumn: true, namespaceIntentColumn: true, namespaceRemoved: 'unknown' },
		{ namespaceRemovedColumn: true, namespaceIntentColumn: true, namespaceRemoved: true, namespaceIntentSha256: 'invalid' }
	])('refuses partial or unknown namespace schema/state %j', async (state) => {
		await expect(readDerivedOutputRetirements(query([{ ...row, ...state }]), Buffer.alloc(32, 1),
			{ batchIds: [row.batchId] })).rejects.toThrow();
	});
	it('refuses protected datasets and inconsistent canonical identities', async () => {
		const selection = { batchIds: [row.batchId] };
		await expect(readDerivedOutputRetirements(query([{ ...row, dataset: 'ledger-close-meta' }]),
			Buffer.alloc(32, 1), selection)).rejects.toThrow('Dataset cannot be retired');
		await expect(readDerivedOutputRetirements(query([row, { ...row, dataset: 'operations', canonicalSha256: '07'.repeat(32) }]),
			Buffer.alloc(32, 1), selection)).rejects.toThrow('Conflicting retirement identity');
	});
	it('asserts exact versioned namespace intent and physical state at runtime', async () => {
		const [legacy] = await readDerivedOutputRetirements(query([row]), Buffer.alloc(32, 1), { batchIds: [row.batchId] });
		if (!legacy) throw new Error('missing test plan');
		const receipt = {
			manifestSha256: row.manifestSha256, range: { startSequence: 3, endSequence: 66 },
			outputs: [{ dataset: 'ledger-close-meta', sha256: row.canonicalSha256 },
				{ dataset: row.dataset, sha256: row.outputSha256, byteCount: 123, recordCount: 7,
					storageKey: row.storageKey, representation: 'typed-projection' }]
		} as unknown as Parameters<typeof assertDerivedOutputRecovery>[1];
		const namespaceOutput = { ...legacy.outputs[0]!, namespaceRemoved: true, namespaceIntentSha256: '08'.repeat(32) };
		const valid: DerivedOutputRecovery = { ...legacy, version: 2, outputs: [namespaceOutput] };
		expect(() => assertDerivedOutputRecovery(valid, receipt, row.networkIdSha256)).not.toThrow();
		for (const invalid of [
			{ ...valid, version: 3 },
			{ ...legacy, outputs: [namespaceOutput] },
			{ ...valid, outputs: legacy.outputs },
			{ ...valid, outputs: [{ ...namespaceOutput, namespaceIntentSha256: null }] },
			{ ...valid, outputs: [{ ...namespaceOutput, namespaceRemoved: false }] },
			{ ...valid, outputs: [{ ...namespaceOutput, removed: 'unknown' }] }
		]) {
			expect(() => assertDerivedOutputRecovery(invalid as unknown as DerivedOutputRecovery,
				receipt, row.networkIdSha256)).toThrow();
		}
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
