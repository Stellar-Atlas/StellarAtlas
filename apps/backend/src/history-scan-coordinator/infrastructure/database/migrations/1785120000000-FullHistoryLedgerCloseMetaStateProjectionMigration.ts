import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	enableFullHistoryLedgerCloseMetaStateDatasetSetSql,
	fullHistoryLedgerCloseMetaDatasetContractPredicateSql,
	fullHistoryLedgerCloseMetaStateProjectionDatasetContractPredicateSql,
	restoreFullHistoryLedgerCloseMetaCoreDatasetSetSql
} from './FullHistoryLedgerCloseMetaDatasetSchemaSql.js';

const migrationTimeouts = `
	set local lock_timeout = '2s';
	set local statement_timeout = '30s'
`;

export class FullHistoryLedgerCloseMetaStateProjectionMigration1785120000000 implements MigrationInterface {
	readonly name =
		'FullHistoryLedgerCloseMetaStateProjectionMigration1785120000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await replaceDatasetContract(
			queryRunner,
			fullHistoryLedgerCloseMetaStateProjectionDatasetContractPredicateSql
		);
		await queryRunner.query(enableFullHistoryLedgerCloseMetaStateDatasetSetSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		assertActiveTransaction(queryRunner);
		await queryRunner.query(migrationTimeouts);
		await queryRunner.query(`
			do $$
			begin
				if exists (
					select 1 from "full_history_ledger_close_meta_dataset"
					where "dataset" in (
						'account-state-changes', 'trustline-state-changes'
					)
				) then
					raise exception 'cannot downgrade LedgerCloseMeta state projections with durable rows';
				end if;
			end
			$$
		`);
		await queryRunner.query(restoreFullHistoryLedgerCloseMetaCoreDatasetSetSql);
		await replaceDatasetContract(
			queryRunner,
			fullHistoryLedgerCloseMetaDatasetContractPredicateSql
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
			'Full-history state projection migration requires an active transaction'
		);
	}
}
