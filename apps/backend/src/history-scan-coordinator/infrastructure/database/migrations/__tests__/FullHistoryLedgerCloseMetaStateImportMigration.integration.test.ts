import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryLedgerCloseMetaStateImportMigration1785130000000 } from '../1785130000000-FullHistoryLedgerCloseMetaStateImportMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryLedgerCloseMetaStateImportMigration1785130000000', () => {
	let batchId: string;
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	const migration =
		new FullHistoryLedgerCloseMetaStateImportMigration1785130000000();

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
		await dataSource.query(
			`
			insert into "full_history_ledger_close_meta_batch" (
				"id", "start_ledger", "end_ledger"
			) values ($1, 3, 66)
			`,
			[batchId]
		);

		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.release();
		await runMigration(migration, 'up');
	});

	beforeEach(async () => {
		await dataSource.query(`
			truncate table "full_history_lcm_account_state_change",
				"full_history_lcm_trustline_state_change",
				"full_history_lcm_state_import"
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('stores every account and trustline field without bigint or byte loss', async () => {
		await insertImport('account-state-changes');
		await insertImport('trustline-state-changes');
		await insertAccountChange();
		await insertTrustlineChange();
		await completeImport('account-state-changes');
		await completeImport('trustline-state-changes');

		const [account] = await dataSource.query<AccountProjection[]>(`
			select array[
				"ledger_sequence"::text, "transaction_index"::text,
				"change_index"::text, "operation_index"::text,
				"upgrade_index"::text, "change_type"::text,
				"last_modified_ledger"::text, "closed_at_unix_millis"::text,
				"balance"::text, "buying_liabilities"::text,
				"selling_liabilities"::text, "sequence_number"::text,
				"sequence_ledger"::text, "sequence_time"::text,
				"subentry_count"::text, "flags"::text,
				"master_weight"::text, "low_threshold"::text,
				"medium_threshold"::text, "high_threshold"::text,
				"sponsored_entry_count"::text, "sponsoring_entry_count"::text,
				"signer_count"::text
			] as numbers,
			array["reason", "change_type_string", "sponsor", "account_id",
				"home_domain", "inflation_destination"] as strings,
			encode("transaction_hash", 'hex') as "transactionHash",
			encode("ledger_key_sha256", 'hex') as "ledgerKeyHash",
			"state_entry_xdr" as "stateEntryXdr", "deleted",
			"signer_keys" as "signerKeys", "signer_weights" as "signerWeights",
			"signer_sponsors" as "signerSponsors"
			from "full_history_lcm_account_state_change"
		`);
		expect(account.numbers).toEqual([
			'42',
			'3',
			'7',
			'2',
			null,
			'1',
			'41',
			'1750000000123',
			'9223372036854775806',
			'9007199254740993',
			'9007199254740994',
			'9223372036854770000',
			'42',
			'1750000000',
			'4',
			'4294967295',
			'255',
			'1',
			'2',
			'3',
			'4',
			'5',
			'2'
		]);
		expect(account.strings).toEqual([
			'operation',
			'LEDGER_ENTRY_UPDATED',
			sponsor,
			accountId,
			'state.example',
			inflationDestination
		]);
		expect(account).toMatchObject({
			deleted: false,
			ledgerKeyHash: Buffer.alloc(32, 2).toString('hex'),
			signerKeys,
			signerSponsors,
			signerWeights,
			stateEntryXdr: accountStateXdr,
			transactionHash: Buffer.alloc(32, 1).toString('hex')
		});

		const [trustline] = await dataSource.query<TrustlineProjection[]>(`
			select array[
				"ledger_sequence"::text, "transaction_index"::text,
				"change_index"::text, "operation_index"::text,
				"upgrade_index"::text, "change_type"::text,
				"last_modified_ledger"::text, "closed_at_unix_millis"::text,
				"asset_type"::text, "balance"::text, "limit"::text,
				"buying_liabilities"::text, "selling_liabilities"::text,
				"liquidity_pool_use_count"::text, "flags"::text
			] as numbers,
			array["reason", "change_type_string", "sponsor", "account_id",
				"asset_type_string", "asset_code", "asset_issuer"] as strings,
			"transaction_hash" as "transactionHash",
			encode("ledger_key_sha256", 'hex') as "ledgerKeyHash",
			encode("liquidity_pool_id", 'hex') as "liquidityPoolId",
			"state_entry_xdr" as "stateEntryXdr", "deleted"
			from "full_history_lcm_trustline_state_change"
		`);
		expect(trustline.numbers).toEqual([
			'43',
			'0',
			'1',
			null,
			'1',
			'2',
			'40',
			'1750000001123',
			'3',
			'9007199254740995',
			'9223372036854775807',
			'1',
			'2',
			'2147483647',
			'4294967295'
		]);
		expect(trustline.strings).toEqual([
			'upgrade',
			'LEDGER_ENTRY_REMOVED',
			null,
			trustlineAccountId,
			'ASSET_TYPE_POOL_SHARE',
			null,
			null
		]);
		expect(trustline).toMatchObject({
			deleted: true,
			ledgerKeyHash: Buffer.alloc(32, 4).toString('hex'),
			liquidityPoolId: liquidityPoolId.toString('hex'),
			stateEntryXdr: trustlineStateXdr,
			transactionHash: null
		});

		const [imports] = await dataSource.query<ImportProjection[]>(`
			select count(*)::text as count,
				array_agg(encode("source_sha256", 'hex') order by "dataset") as hashes,
				bool_and("status" = 'complete'
					and "imported_record_count" = "expected_record_count"
					and "lease_owner" is null and "lease_expires_at" is null
					and "completed_at" is not null) as "allComplete"
			from "full_history_lcm_state_import"
		`);
		expect(imports).toEqual({
			allComplete: true,
			count: '2',
			hashes: [
				Buffer.alloc(32, 8).toString('hex'),
				Buffer.alloc(32, 9).toString('hex')
			]
		});
	});

	it('enforces exact identities, batch ranges, foreign keys, and enums', async () => {
		await expect(rawImport(batchId, 'accounts', 'pending')).rejects.toThrow(
			/dataset/i
		);
		await expect(
			rawImport(batchId, 'account-state-changes', 'ready')
		).rejects.toThrow(/status|lifecycle/i);
		await expect(
			rawImport(randomUUID(), 'account-state-changes', 'pending')
		).rejects.toThrow(/state_import_batch/i);
		await expect(insertAccountChange({ ledgerSequence: 67 })).rejects.toThrow(
			/outside its batch range/i
		);
		await expect(insertAccountChange({ transactionIndex: -1 })).rejects.toThrow(
			/account_change_identity/i
		);
		await expect(insertAccountChange({ signerCount: 1 })).rejects.toThrow(
			/account_change_signers/i
		);
		await insertAccountChange();
		await expect(insertAccountChange()).rejects.toThrow(
			/account_state_change/i
		);
		await expect(insertTrustlineChange({ poolId: null })).rejects.toThrow(
			/trustline_change_asset/i
		);
	});

	it('freezes completed imports and all evidence rows', async () => {
		await insertImport('account-state-changes');
		await insertImport('trustline-state-changes');
		await insertAccountChange();
		await insertTrustlineChange();
		await completeImport('account-state-changes');
		await completeImport('trustline-state-changes');

		await expect(
			dataSource.query(
				`update "full_history_lcm_state_import" set "status" = 'failed'
				 where "batch_id" = $1 and "dataset" = 'account-state-changes'`,
				[batchId]
			)
		).rejects.toThrow(/completed.*immutable/i);
		await expect(
			dataSource.query(
				`delete from "full_history_lcm_state_import"
				 where "batch_id" = $1 and "dataset" = 'trustline-state-changes'`,
				[batchId]
			)
		).rejects.toThrow(/completed.*immutable/i);
		for (const table of [
			'full_history_lcm_account_state_change',
			'full_history_lcm_trustline_state_change'
		]) {
			await expect(
				dataSource.query(`update "${table}" set "deleted" = false`)
			).rejects.toThrow(/evidence is immutable/i);
			await expect(dataSource.query(`delete from "${table}"`)).rejects.toThrow(
				/evidence is immutable/i
			);
		}
	});

	it('refuses down with durable rows and removes an empty schema', async () => {
		await rawImport(batchId, 'account-state-changes', 'pending');
		await expect(runMigration(migration, 'down')).rejects.toThrow(
			/cannot downgrade.*durable rows/i
		);
		await dataSource.query('truncate table "full_history_lcm_state_import"');
		await insertAccountChange();
		await expect(runMigration(migration, 'down')).rejects.toThrow(
			/cannot downgrade.*durable rows/i
		);
		await dataSource.query(
			'truncate table "full_history_lcm_account_state_change"'
		);

		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await migration.down(runner);
			const relations = await runner.query<
				Array<{ readonly relation: string | null }>
			>(`
				select to_regclass('full_history_lcm_state_import') as relation
				union all select to_regclass('full_history_lcm_account_state_change')
				union all select to_regclass('full_history_lcm_trustline_state_change')
			`);
			expect(relations).toEqual([
				{ relation: null },
				{ relation: null },
				{ relation: null }
			]);
		} finally {
			await runner.rollbackTransaction();
			await runner.release();
		}
	});

	async function insertImport(dataset: StateDataset): Promise<void> {
		await dataSource.query(
			`insert into "full_history_lcm_state_import" (
				"batch_id", "dataset", "source_path", "source_sha256",
				"expected_record_count", "status", "lease_owner",
				"lease_expires_at", "attempt_count"
			) values ($1, $2, $3, $4, 1, 'importing', $5, now() + interval '5 minutes', 1)`,
			[
				batchId,
				dataset,
				`typed/${batchId}/${dataset}.parquet`,
				Buffer.alloc(32, dataset === 'account-state-changes' ? 8 : 9),
				randomUUID()
			]
		);
	}

	async function completeImport(dataset: StateDataset): Promise<void> {
		await dataSource.query(
			`update "full_history_lcm_state_import"
			 set "status" = 'complete', "imported_record_count" = 1,
				"lease_owner" = null, "lease_expires_at" = null,
				"completed_at" = now(), "updated_at" = now()
			 where "batch_id" = $1 and "dataset" = $2`,
			[batchId, dataset]
		);
	}

	async function rawImport(
		targetBatchId: string,
		dataset: string,
		status: string
	): Promise<unknown> {
		return dataSource.query(
			`insert into "full_history_lcm_state_import" (
				"batch_id", "dataset", "source_path", "source_sha256",
				"expected_record_count", "status"
			) values ($1, $2, 'state.parquet', $3, 1, $4)`,
			[targetBatchId, dataset, Buffer.alloc(32, 7), status]
		);
	}

	async function insertAccountChange(
		options: AccountInsertOptions = {}
	): Promise<void> {
		await dataSource.query(
			`insert into "full_history_lcm_account_state_change" (
				"batch_id", "ledger_sequence", "transaction_index", "change_index",
				"transaction_hash", "reason", "operation_index", "upgrade_index",
				"change_type", "change_type_string", "deleted", "ledger_key_sha256",
				"state_entry_xdr", "last_modified_ledger", "sponsor",
				"closed_at_unix_millis", "account_id", "balance",
				"buying_liabilities", "selling_liabilities", "sequence_number",
				"sequence_ledger", "sequence_time", "subentry_count", "flags",
				"home_domain", "inflation_destination", "master_weight",
				"low_threshold", "medium_threshold", "high_threshold",
				"sponsored_entry_count", "sponsoring_entry_count", "signer_count",
				"signer_keys", "signer_weights", "signer_sponsors"
			) values (
				$1, $2, $3, 7, $4, 'operation', 2, null, 1,
				'LEDGER_ENTRY_UPDATED', false, $5, $6, 41, $7, 1750000000123,
				$8, '9223372036854775806', '9007199254740993',
				'9007199254740994', '9223372036854770000', 42, 1750000000,
				4, 4294967295, 'state.example', $9, 255, 1, 2, 3, 4, 5, $10,
				$11::jsonb, $12::jsonb, $13::jsonb
			)`,
			[
				options.batchId ?? batchId,
				options.ledgerSequence ?? 42,
				options.transactionIndex ?? 3,
				Buffer.alloc(32, 1),
				Buffer.alloc(32, 2),
				accountStateXdr,
				sponsor,
				accountId,
				inflationDestination,
				options.signerCount ?? 2,
				JSON.stringify(signerKeys),
				JSON.stringify(signerWeights),
				JSON.stringify(signerSponsors)
			]
		);
	}

	async function insertTrustlineChange(
		options: TrustlineInsertOptions = {}
	): Promise<void> {
		await dataSource.query(
			`insert into "full_history_lcm_trustline_state_change" (
				"batch_id", "ledger_sequence", "transaction_index", "change_index",
				"transaction_hash", "reason", "operation_index", "upgrade_index",
				"change_type", "change_type_string", "deleted", "ledger_key_sha256",
				"state_entry_xdr", "last_modified_ledger", "sponsor",
				"closed_at_unix_millis", "account_id", "asset_type",
				"asset_type_string", "asset_code", "asset_issuer",
				"liquidity_pool_id", "balance", "limit", "buying_liabilities",
				"selling_liabilities", "liquidity_pool_use_count", "flags"
			) values (
				$1, 43, 0, 1, null, 'upgrade', null, 1, 2,
				'LEDGER_ENTRY_REMOVED', true, $2, $3, 40, null, 1750000001123,
				$4, 3, 'ASSET_TYPE_POOL_SHARE', null, null, $5,
				'9007199254740995', '9223372036854775807', 1, 2,
				2147483647, 4294967295
			)`,
			[
				options.batchId ?? batchId,
				Buffer.alloc(32, 4),
				trustlineStateXdr,
				trustlineAccountId,
				options.poolId === undefined ? liquidityPoolId : options.poolId
			]
		);
	}

	async function runMigration(
		target: FullHistoryLedgerCloseMetaStateImportMigration1785130000000,
		direction: 'down' | 'up'
	): Promise<void> {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await target[direction](runner);
			await runner.commitTransaction();
		} catch (error) {
			await runner.rollbackTransaction();
			throw error;
		} finally {
			await runner.release();
		}
	}
});

type StateDataset = 'account-state-changes' | 'trustline-state-changes';

interface AccountInsertOptions {
	readonly batchId?: string;
	readonly ledgerSequence?: number;
	readonly signerCount?: number;
	readonly transactionIndex?: number;
}

interface TrustlineInsertOptions {
	readonly batchId?: string;
	readonly poolId?: Buffer | null;
}

interface AccountProjection {
	readonly deleted: boolean;
	readonly ledgerKeyHash: string;
	readonly numbers: Array<string | null>;
	readonly signerKeys: string[];
	readonly signerSponsors: string[];
	readonly signerWeights: number[];
	readonly stateEntryXdr: Buffer;
	readonly strings: Array<string | null>;
	readonly transactionHash: string | null;
}

interface TrustlineProjection {
	readonly deleted: boolean;
	readonly ledgerKeyHash: string;
	readonly liquidityPoolId: string | null;
	readonly numbers: Array<string | null>;
	readonly stateEntryXdr: Buffer;
	readonly strings: Array<string | null>;
	readonly transactionHash: Buffer | null;
}

interface ImportProjection {
	readonly allComplete: boolean;
	readonly count: string;
	readonly hashes: string[];
}

const accountId = `G${'A'.repeat(55)}`;
const sponsor = `G${'B'.repeat(55)}`;
const inflationDestination = `G${'C'.repeat(55)}`;
const trustlineAccountId = `G${'D'.repeat(55)}`;
const signerKeys = [`G${'E'.repeat(55)}`, `T${'F'.repeat(55)}`];
const signerWeights = [1, 255];
const signerSponsors = ['', `G${'1'.repeat(55)}`];
const accountStateXdr = Buffer.from([0, 1, 2, 255]);
const trustlineStateXdr = Buffer.from([255, 3, 2, 1, 0]);
const liquidityPoolId = Buffer.alloc(32, 6);
