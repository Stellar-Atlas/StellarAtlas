import { DataSource, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { ParsedHistoryObservationMigration1784850000000 } from '../1784850000000-ParsedHistoryObservationMigration.js';

jest.setTimeout(60_000);

describe('ParsedHistoryObservationMigration1784850000000 in PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await createSourceTables(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('repairs an interrupted empty table and reruns safely', async () => {
		await dataSource.query(`
			create table parsed_ledger_header_observation (id bigserial not null)
		`);
		await runMigration(dataSource, 'up');
		await runMigration(dataSource, 'up');

		const columns = (await dataSource.query(`
			select "column_name" as name
			from information_schema.columns
			where table_schema = current_schema()
				and table_name = 'parsed_ledger_header_observation'
		`)) as { readonly name: string }[];
		expect(columns.map((column) => column.name).sort()).toEqual([
			'closedAt',
			'id',
			'observedAt',
			'parsedLedgerHeaderId',
			'sourceObjectRemoteId'
		]);

		const constraints = (await dataSource.query(`
			select conname as name
			from pg_constraint
			where conrelid = 'parsed_ledger_header_observation'::regclass
		`)) as { readonly name: string }[];
		expect(new Set(constraints.map((constraint) => constraint.name))).toEqual(
			new Set([
				'FK_parsed_ledger_header_observation_row',
				'PK_parsed_ledger_header_observation',
				'UQ_parsed_ledger_header_observation_source'
			])
		);
	});

	it('rejects expected names backed by incompatible database objects', async () => {
		const incompatibleDefinitions = [
			{
				id: 'bigint default 0 not null',
				uniqueColumns: '"parsedLedgerHeaderId", "sourceObjectRemoteId"',
				uniqueOptions: '',
				deleteAction: 'on delete cascade',
				indexColumn: '"sourceObjectRemoteId"'
			},
			{
				id: 'bigserial not null',
				uniqueColumns: '"sourceObjectRemoteId"',
				uniqueOptions: '',
				deleteAction: '',
				indexColumn: '"sourceObjectRemoteId"'
			},
			{
				id: 'bigserial not null',
				uniqueColumns: '"parsedLedgerHeaderId", "sourceObjectRemoteId"',
				uniqueOptions: '',
				deleteAction: 'on delete cascade',
				indexColumn: '"observedAt"'
			},
			{
				id: 'bigserial not null',
				uniqueColumns: '"parsedLedgerHeaderId", "sourceObjectRemoteId"',
				uniqueOptions: 'deferrable initially deferred',
				deleteAction: 'on delete cascade',
				indexColumn: '"sourceObjectRemoteId"'
			}
		] as const;

		for (const definition of incompatibleDefinitions) {
			await resetObservationTables(dataSource);
			await createSpoofedLedgerObservationTable(dataSource, definition);

			await expect(runMigration(dataSource, 'up')).rejects.toThrow(
				/parsed-history observation .* incompatible/i
			);
		}

		await resetObservationTables(dataSource);
		await runMigration(dataSource, 'up');
	});

	it('bounds down-migration lock acquisition instead of waiting indefinitely', async () => {
		const blocker = dataSource.createQueryRunner();
		await blocker.connect();
		await blocker.startTransaction();
		await blocker.query(
			'lock table parsed_ledger_header_observation in access share mode'
		);

		const startedAt = Date.now();
		try {
			await expect(runMigration(dataSource, 'down')).rejects.toThrow(
				/lock timeout|canceling statement due to lock timeout/i
			);
			expect(Date.now() - startedAt).toBeLessThan(10_000);
		} finally {
			await blocker.rollbackTransaction();
			await blocker.release();
		}
	});
});

async function createSourceTables(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table parsed_ledger_header (id serial primary key);
		create table parsed_transaction_envelope (id serial primary key);
		create table parsed_transaction_result (id serial primary key)
	`);
}

async function resetObservationTables(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		drop table if exists parsed_transaction_result_observation;
		drop table if exists parsed_transaction_envelope_observation;
		drop table if exists parsed_ledger_header_observation
	`);
}

async function createSpoofedLedgerObservationTable(
	dataSource: DataSource,
	definition: {
		readonly id: string;
		readonly uniqueColumns: string;
		readonly uniqueOptions: string;
		readonly deleteAction: string;
		readonly indexColumn: string;
	}
): Promise<void> {
	await dataSource.query(`
		create table parsed_ledger_header_observation (
			id ${definition.id},
			"parsedLedgerHeaderId" integer not null,
			"sourceObjectRemoteId" text not null,
			"observedAt" timestamptz not null,
			"closedAt" timestamptz,
			constraint "PK_parsed_ledger_header_observation" primary key (id),
			constraint "UQ_parsed_ledger_header_observation_source"
				unique (${definition.uniqueColumns}) ${definition.uniqueOptions},
			constraint "FK_parsed_ledger_header_observation_row"
				foreign key ("parsedLedgerHeaderId")
				references parsed_ledger_header (id) ${definition.deleteAction}
		);
		create index "IDX_parsed_ledger_header_observation_object"
			on parsed_ledger_header_observation (${definition.indexColumn})
	`);
}

async function runMigration(
	dataSource: DataSource,
	direction: 'down' | 'up'
): Promise<void> {
	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();
	await queryRunner.startTransaction();
	try {
		const migration = new ParsedHistoryObservationMigration1784850000000();
		await migration[direction](queryRunner as QueryRunner);
		await queryRunner.commitTransaction();
	} catch (error) {
		await queryRunner.rollbackTransaction();
		throw error;
	} finally {
		await queryRunner.release();
	}
}
