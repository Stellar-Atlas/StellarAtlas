import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	compactLedgerEntryChangeDatasetPredicateSql,
	enableFullHistoryLedgerCloseMetaCompactDatasetSetSql,
	enableFullHistoryLedgerCloseMetaStateDatasetSetSql,
	fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql,
	fullHistoryLedgerCloseMetaStateProjectionDatasetContractPredicateSql
} from './FullHistoryLedgerCloseMetaDatasetSchemaSql.js';

// An explicit catalog migration candidate; the current producer's migration
// set must not select it or emit v4 before separate reader/rollout review.
export class FullHistoryLedgerEntryChangeCompactMigration1794268800000 implements MigrationInterface {
	readonly name = 'FullHistoryLedgerEntryChangeCompactMigration1794268800000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await prepare(queryRunner);
		await replaceContract(
			queryRunner,
			fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql
		);
		await queryRunner.query(
			enableFullHistoryLedgerCloseMetaCompactDatasetSetSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await prepare(queryRunner);
		// Hold the catalog lock across the downgrade check and DDL.
		await queryRunner.query(
			'lock table "full_history_ledger_close_meta_dataset" in access exclusive mode'
		);
		await queryRunner.query(`
			do $$
			begin
				if exists (
					select 1 from "full_history_ledger_close_meta_dataset"
					where ${compactLedgerEntryChangeDatasetPredicateSql}
				) then
					raise exception 'cannot downgrade compact ledger entry changes with durable rows';
				end if;
			end
			$$
		`);
		await queryRunner.query(enableFullHistoryLedgerCloseMetaStateDatasetSetSql);
		await replaceContract(
			queryRunner,
			fullHistoryLedgerCloseMetaStateProjectionDatasetContractPredicateSql
		);
	}
}

async function prepare(queryRunner: QueryRunner): Promise<void> {
	if (!queryRunner.isTransactionActive) {
		throw new Error(
			'Compact ledger entry changes require an active transaction'
		);
	}
	await queryRunner.query(`
		set local lock_timeout = '2s';
		set local statement_timeout = '30s'
	`);
}

async function replaceContract(
	queryRunner: QueryRunner,
	predicate: string
): Promise<void> {
	// The old constraint validated retained rows; the additive check applies to
	// every new row immediately, without re-scanning the catalog on activation.
	await queryRunner.query(`
		alter table "full_history_ledger_close_meta_dataset"
			drop constraint "chk_full_history_lcm_dataset_contract",
			add constraint "chk_full_history_lcm_dataset_contract"
				check (${predicate}) not valid
	`);
}
