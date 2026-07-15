import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	createFullHistoryLedgerCloseMetaCanonicalCoverageSql,
	dropFullHistoryLedgerCloseMetaCanonicalCoverageSql
} from './FullHistoryLedgerCloseMetaCanonicalCoverageSchemaSql.js';
import {
	dropFullHistoryStateImportEvidenceHardeningSql,
	hardenFullHistoryStateImportEvidenceSql
} from './FullHistoryStateImportEvidenceSchemaSql.js';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000 implements MigrationInterface {
	readonly name =
		'FullHistoryLedgerCloseMetaCanonicalCoverageMigration1785140000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(hardenFullHistoryStateImportEvidenceSql);
		await queryRunner.query(
			createFullHistoryLedgerCloseMetaCanonicalCoverageSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		const rows = (await queryRunner.query(`
			select
				(select count(*) from "full_history_lcm_state_canonical_coverage")
				+ (select count(*) from "full_history_lcm_ledger_projection")
				+ (select count(*) from "full_history_lcm_state_canonical_batch_link")
				+ (select count(*) from "full_history_lcm_state_import"
					where "imported_row_set_sha256" is not null)
				+ (select count(*) from "full_history_lcm_account_state_change")
				+ (select count(*) from "full_history_lcm_trustline_state_change")
				as "rowCount"
		`)) as Array<{ readonly rowCount: string }>;
		if (BigInt(rows[0]?.rowCount ?? '-1') !== 0n) {
			throw new Error(
				'Cannot downgrade canonical coverage migration with durable rows'
			);
		}
		await queryRunner.query(dropFullHistoryLedgerCloseMetaCanonicalCoverageSql);
		await queryRunner.query(dropFullHistoryStateImportEvidenceHardeningSql);
	}
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error('Canonical coverage migration requires a transaction');
	}
}
