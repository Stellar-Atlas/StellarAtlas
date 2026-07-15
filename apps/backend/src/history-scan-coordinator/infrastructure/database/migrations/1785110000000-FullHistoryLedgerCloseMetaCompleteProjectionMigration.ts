import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	fullHistoryLedgerCloseMetaDatasetContractPredicateSql,
	legacyFullHistoryLedgerCloseMetaDatasetContractPredicateSql
} from './FullHistoryLedgerCloseMetaDatasetSchemaSql.js';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000 implements MigrationInterface {
	readonly name =
		'FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await replaceDatasetContract(
			queryRunner,
			fullHistoryLedgerCloseMetaDatasetContractPredicateSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(`
			do $$
			begin
				if exists (
					select 1 from "full_history_ledger_close_meta_dataset"
					where "schema_version" in (
						'stellar-atlas.full-history.contract-events.v3',
						'stellar-atlas.full-history.ledger-entry-changes.v3'
					)
				) then
					raise exception 'cannot downgrade complete LedgerCloseMeta projections with v3 rows';
				end if;
			end
			$$
		`);
		await replaceDatasetContract(
			queryRunner,
			legacyFullHistoryLedgerCloseMetaDatasetContractPredicateSql
		);
	}
}

async function replaceDatasetContract(
	queryRunner: QueryRunner,
	predicate: string
): Promise<void> {
	await queryRunner.query(`
		alter table "full_history_ledger_close_meta_dataset"
			drop constraint "chk_full_history_lcm_dataset_contract";
		alter table "full_history_ledger_close_meta_dataset"
			add constraint "chk_full_history_lcm_dataset_contract" check (
				${predicate}
			)
	`);
}

function assertActiveTransaction(queryRunner: QueryRunner): void {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Full-history complete projection migration requires an active transaction'
		);
	}
}
