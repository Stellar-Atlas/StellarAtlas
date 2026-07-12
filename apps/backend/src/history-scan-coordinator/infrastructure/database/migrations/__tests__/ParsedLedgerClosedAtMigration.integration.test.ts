import { DataSource, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { ParsedLedgerHeaderMigration1784000000000 } from '../1784000000000-ParsedLedgerHeaderMigration.js';
import { ParsedLedgerClosedAtMigration1784840000000 } from '../1784840000000-ParsedLedgerClosedAtMigration.js';

jest.setTimeout(60_000);

interface ColumnRow {
	readonly columnDefault: string | null;
	readonly columnName: string;
	readonly dataType: string;
	readonly isNullable: string;
}

interface RelationRow {
	readonly relfilenode: string;
}

describe('ParsedLedgerClosedAtMigration1784840000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('adds and removes the nullable column without rewriting existing rows', async () => {
		const baseMigration = new ParsedLedgerHeaderMigration1784000000000();
		const migration = new ParsedLedgerClosedAtMigration1784840000000();
		const queryRunner = dataSource.createQueryRunner();
		await queryRunner.connect();

		try {
			await baseMigration.up(queryRunner);
			await insertLegacyHeaders(queryRunner, 50_000);
			const relationBefore = await readRelation(queryRunner);

			await queryRunner.startTransaction();
			await migration.up(queryRunner);
			await migration.up(queryRunner);

			expect(await readColumns(queryRunner)).toEqual(expectedColumns());
			expect(await readRelation(queryRunner)).toEqual(relationBefore);
			await expect(
				queryRunner.query(`
					select count(*) as count
					from parsed_ledger_header
					where "closedAt" is null
				`)
			).resolves.toEqual([{ count: '50000' }]);

			await migration.down(queryRunner);
			await migration.down(queryRunner);
			expect(await readColumns(queryRunner)).toEqual([]);
			await queryRunner.commitTransaction();
		} finally {
			if (queryRunner.isTransactionActive) {
				await queryRunner.rollbackTransaction();
			}
			await baseMigration.down(queryRunner);
			await queryRunner.release();
		}
	});

	it('times out under lock contention and succeeds on retry', async () => {
		const baseMigration = new ParsedLedgerHeaderMigration1784000000000();
		const migration = new ParsedLedgerClosedAtMigration1784840000000();
		const blocker = dataSource.createQueryRunner();
		const migrator = dataSource.createQueryRunner();
		await Promise.all([blocker.connect(), migrator.connect()]);

		try {
			await baseMigration.up(migrator);
			await blocker.startTransaction();
			await blocker.query(
				'lock table parsed_ledger_header in access share mode'
			);
			await migrator.startTransaction();

			const startedAt = Date.now();
			await expect(migration.up(migrator)).rejects.toThrow(/lock timeout/i);
			const elapsedMs = Date.now() - startedAt;
			expect(elapsedMs).toBeGreaterThanOrEqual(1_500);
			expect(elapsedMs).toBeLessThan(10_000);
			await migrator.rollbackTransaction();
			expect(await readColumns(migrator)).toEqual([]);
			await blocker.commitTransaction();

			await migrator.startTransaction();
			await migration.up(migrator);
			await migrator.commitTransaction();
			expect(await readColumns(migrator)).toEqual(expectedColumns());

			await migrator.startTransaction();
			await migration.down(migrator);
			await migrator.commitTransaction();
		} finally {
			if (migrator.isTransactionActive) {
				await migrator.rollbackTransaction();
			}
			if (blocker.isTransactionActive) {
				await blocker.rollbackTransaction();
			}
			await baseMigration.down(migrator);
			await Promise.all([blocker.release(), migrator.release()]);
		}
	});

	async function insertLegacyHeaders(
		queryRunner: QueryRunner,
		count: number
	): Promise<void> {
		await queryRunner.query(
			`
			insert into parsed_ledger_header (
				"ledgerSequence", "ledgerHeaderHash", "previousLedgerHeaderHash",
				"transactionSetHash", "transactionResultHash", "bucketListHash",
				"protocolVersion", "firstSourceArchiveUrl", "lastSourceArchiveUrl",
				"lastScanJobRemoteId", "firstSeenAt", "lastSeenAt"
			)
			select
				sequence, 'header-' || sequence, 'previous-' || sequence,
				'transactions-' || sequence, 'results-' || sequence,
				'buckets-' || sequence, 27, 'https://archive.example',
				'https://archive.example', 'job-1', now(), now()
			from generate_series(1, $1) as sequence
			`,
			[count]
		);
	}

	async function readColumns(queryRunner: QueryRunner): Promise<ColumnRow[]> {
		const rows = (await queryRunner.query(`
			select
				column_default as "columnDefault",
				column_name as "columnName",
				data_type as "dataType",
				is_nullable as "isNullable"
			from information_schema.columns
			where table_name = 'parsed_ledger_header'
				and column_name in (
					'closedAt', 'closedAtObservedAt', 'closedAtScanJobRemoteId',
					'closedAtSourceArchiveUrl'
				)
			order by column_name
		`)) as unknown as ColumnRow[];
		return rows;
	}

	function expectedColumns(): ColumnRow[] {
		return [
			{
				columnDefault: null,
				columnName: 'closedAt',
				dataType: 'timestamp with time zone',
				isNullable: 'YES'
			},
			{
				columnDefault: null,
				columnName: 'closedAtObservedAt',
				dataType: 'timestamp with time zone',
				isNullable: 'YES'
			},
			{
				columnDefault: null,
				columnName: 'closedAtScanJobRemoteId',
				dataType: 'text',
				isNullable: 'YES'
			},
			{
				columnDefault: null,
				columnName: 'closedAtSourceArchiveUrl',
				dataType: 'text',
				isNullable: 'YES'
			}
		];
	}

	async function readRelation(queryRunner: QueryRunner): Promise<RelationRow> {
		const rows = (await queryRunner.query(`
			select relfilenode::text as relfilenode
			from pg_class
			where oid = 'parsed_ledger_header'::regclass
		`)) as unknown as RelationRow[];
		const row = rows[0];
		if (row === undefined) throw new Error('Parsed ledger table is missing');
		return row;
	}
});
