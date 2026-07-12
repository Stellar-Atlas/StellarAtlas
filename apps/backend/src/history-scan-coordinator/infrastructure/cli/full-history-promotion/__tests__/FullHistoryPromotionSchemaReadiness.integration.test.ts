import { DataSource, type MigrationInterface, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { fullHistoryEntities } from '../../../database/full-history/__tests__/FullHistoryCanonicalFixture.js';
import { installPromotionSchema } from '../../../database/full-history-promotion/__tests__/FullHistoryPromotionPostgresFixture.js';
import { checkFullHistoryPromotionSchemaReadiness } from '../FullHistoryPromotionSchemaReadiness.js';

jest.setTimeout(60_000);

describe('full-history promotion schema readiness', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = createDataSource(postgres.url);
		await dataSource.initialize();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('fails closed before schema installation and becomes ready after exact migrations', async () => {
		const before = await checkFullHistoryPromotionSchemaReadiness(dataSource);
		expect(before.ready).toBe(false);
		expect(before.missingSchemaObjects).toContain(
			'relation:full_history_ingestion_batch'
		);

		await installPromotionSchema(dataSource);
		await expect(
			checkFullHistoryPromotionSchemaReadiness(dataSource)
		).resolves.toEqual({
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		});
	});

	it('reports a pending migration without applying it', async () => {
		await dataSource.destroy();
		dataSource = createDataSource(postgres.url, [
			PendingFullHistoryFixtureMigration1999999999999
		]);
		await dataSource.initialize();

		await expect(
			checkFullHistoryPromotionSchemaReadiness(dataSource)
		).resolves.toEqual({
			missingSchemaObjects: [],
			pendingMigrations: true,
			ready: false
		});
		const rows = (await dataSource.query(
			`select to_regclass('full_history_cli_forbidden_migration') as relation`
		)) as Array<{ readonly relation: string | null }>;
		expect(rows).toEqual([{ relation: null }]);
	});
});

class PendingFullHistoryFixtureMigration1999999999999 implements MigrationInterface {
	readonly name = 'PendingFullHistoryFixtureMigration1999999999999';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'create table full_history_cli_forbidden_migration (id integer)'
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop table if exists full_history_cli_forbidden_migration'
		);
	}
}

function createDataSource(
	url: string,
	migrations: readonly (new () => MigrationInterface)[] = []
): DataSource {
	return new DataSource({
		entities: fullHistoryEntities,
		logging: false,
		migrations: [...migrations],
		migrationsRun: false,
		synchronize: false,
		type: 'postgres',
		url
	});
}
