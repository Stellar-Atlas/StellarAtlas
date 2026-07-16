import type { DataSource } from 'typeorm';
import { checkFullHistoryLedgerCloseMetaSchemaReadiness } from '../FullHistoryLedgerCloseMetaSchemaReadiness.js';

describe('full-history LedgerCloseMeta schema readiness', () => {
	it('accepts the complete schema contract with no pending migrations', async () => {
		const readiness = await checkFullHistoryLedgerCloseMetaSchemaReadiness(
			dataSource(false)
		);

		expect(readiness).toEqual({
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		});
	});

	it('rejects pending migrations even when required objects exist', async () => {
		const readiness = await checkFullHistoryLedgerCloseMetaSchemaReadiness(
			dataSource(true)
		);

		expect(readiness).toEqual({
			missingSchemaObjects: [],
			pendingMigrations: true,
			ready: false
		});
	});

	it('reports drift across every schema object class', async () => {
		const missing = new Set([
			'full_history_watermark',
			'full_history_ledger_close_meta_dataset.output_sha256',
			'chk_full_history_lcm_dataset_contract',
			'full_history_ledger_close_meta_watermark.trg_validate_full_history_lcm_watermark_advance',
			'assert_full_history_lcm_batch_dataset_set(uuid)',
			'full_history_ledger_close_meta_batch.idx_full_history_lcm_batch_frontier'
		]);
		const readiness = await checkFullHistoryLedgerCloseMetaSchemaReadiness(
			dataSource(false, missing)
		);

		expect(readiness.ready).toBe(false);
		expect(readiness.missingSchemaObjects).toEqual([
			'column:full_history_ledger_close_meta_dataset.output_sha256',
			'constraint:chk_full_history_lcm_dataset_contract',
			'function:assert_full_history_lcm_batch_dataset_set(uuid)',
			'index:full_history_ledger_close_meta_batch.idx_full_history_lcm_batch_frontier',
			'relation:full_history_watermark',
			'trigger:full_history_ledger_close_meta_watermark.trg_validate_full_history_lcm_watermark_advance'
		]);
	});
});

function dataSource(
	pendingMigrations: boolean,
	missing: ReadonlySet<string> = new Set()
): DataSource {
	return {
		query: jest.fn(
			async (_sql: string, parameters?: readonly [readonly string[]]) => {
				const requested = parameters?.[0] ?? [];
				return requested
					.filter((name) => missing.has(name))
					.map((name) => ({ name }));
			}
		),
		showMigrations: jest.fn(async () => pendingMigrations)
	} as unknown as DataSource;
}
