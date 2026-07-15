import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryAccountStateChange } from '../../../../domain/full-history-state-import/FullHistoryStateExport.js';
import { FullHistoryLedgerCloseMetaStateImportMigration1785130000000 } from '../../migrations/1785130000000-FullHistoryLedgerCloseMetaStateImportMigration.js';
import { TypeOrmFullHistoryStateImportRepository } from '../TypeOrmFullHistoryStateImportRepository.js';

jest.setTimeout(60_000);

describe('TypeOrmFullHistoryStateImportRepository', () => {
	let batchId: string;
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryStateImportRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		batchId = randomUUID();
		await dataSource.query(`
			create table "full_history_ledger_close_meta_batch" (
				"id" uuid not null primary key,
				"start_ledger" bigint not null,
				"end_ledger" bigint not null
			)
		`);
		await dataSource.query(`
			create table "full_history_ledger_close_meta_dataset" (
				"batch_id" uuid not null,
				"dataset" text not null,
				"storage_key" text not null,
				"output_sha256" bytea not null,
				"record_count" bigint not null,
				primary key ("batch_id", "dataset")
			)
		`);
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_batch"
				("id", "start_ledger", "end_ledger") values ($1, 3, 66)`,
			[batchId]
		);
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_dataset" (
				"batch_id", "dataset", "storage_key", "output_sha256", "record_count"
			) values ($1, 'account-state-changes', 'typed/account.parquet', $2, 1)`,
			[batchId, Buffer.alloc(32, 7)]
		);
		await runMigration(dataSource);
		repository = new TypeOrmFullHistoryStateImportRepository(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('registers, claims, stores idempotently, and completes exact evidence', async () => {
		await expect(repository.registerPendingImports()).resolves.toBe(1);
		await expect(repository.registerPendingImports()).resolves.toBe(0);
		const owner = randomUUID();
		const claim = await repository.claimNext(owner, 30_000);
		expect(claim).toMatchObject({
			batchId,
			dataset: 'account-state-changes',
			endLedger: 66,
			expectedRecordCount: 1n,
			leaseOwner: owner,
			startLedger: 3,
			storageKey: 'typed/account.parquet'
		});
		expect(claim).not.toBeNull();
		if (claim === null) throw new Error('Expected state import claim');
		const controls = await dataSource.query<
			Array<{ readonly leaseOwner: string | null; readonly status: string }>
		>(
			`select "lease_owner"::text as "leaseOwner", "status"
			 from "full_history_lcm_state_import" where "batch_id" = $1`,
			[batchId]
		);
		expect(controls).toEqual([{ leaseOwner: owner, status: 'importing' }]);
		await repository.renewLease(claim, 30_000);
		await repository.storeAccountRows(claim, [accountRow()]);
		await repository.storeAccountRows(claim, [accountRow()]);
		await repository.complete(claim, 1n);

		const rows = await dataSource.query<
			Array<{ readonly count: string; readonly status: string }>
		>(`
			select control."status", count(state.*)::text as "count"
			from "full_history_lcm_state_import" control
			left join "full_history_lcm_account_state_change" state
				on state."batch_id" = control."batch_id"
			group by control."status"
		`);
		expect(rows).toEqual([{ count: '1', status: 'complete' }]);
		await expect(
			repository.claimNext(randomUUID(), 30_000)
		).resolves.toBeNull();
	});
});

async function runMigration(dataSource: DataSource): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await new FullHistoryLedgerCloseMetaStateImportMigration1785130000000().up(
			runner
		);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}

function accountRow(): FullHistoryAccountStateChange {
	return {
		accountId: `G${'A'.repeat(55)}`,
		balance: '1',
		buyingLiabilities: '0',
		changeIndex: '1',
		changeType: 1,
		changeTypeString: 'LedgerEntryChangeTypeLedgerEntryUpdated',
		closedAtUnixMillis: '1',
		deleted: false,
		flags: '0',
		highThreshold: 1,
		homeDomain: '',
		inflationDestination: null,
		lastModifiedLedger: '3',
		ledgerKeySha256: 'a'.repeat(64),
		ledgerSequence: '3',
		lowThreshold: 1,
		masterWeight: 1,
		mediumThreshold: 1,
		operationIndex: '1',
		reason: 'operation',
		sellingLiabilities: '0',
		sequenceLedger: null,
		sequenceNumber: '1',
		sequenceTime: null,
		signerCount: '0',
		signerKeys: [],
		signerSponsors: [],
		signerWeights: [],
		sponsor: null,
		sponsoredEntryCount: '0',
		sponsoringEntryCount: '0',
		stateEntryXdrBase64: 'AQ==',
		subentryCount: '0',
		transactionHash: 'b'.repeat(64),
		transactionIndex: '1',
		upgradeIndex: null
	};
}
