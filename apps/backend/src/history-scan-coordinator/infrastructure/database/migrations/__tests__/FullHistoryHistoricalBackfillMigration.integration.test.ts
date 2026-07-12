import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { hashNetworkPassphrase } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { insertBatch } from '../../full-history/FullHistoryCanonicalBatchStore.js';
import { storeCanonicalFacts } from '../../full-history/FullHistoryCanonicalFactStore.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../full-history/TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { FullHistoryHistoricalBackfillMigration1784940000000 } from '../1784940000000-FullHistoryHistoricalBackfillMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryHistoricalBackfillMigration1784940000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installFullHistoryCanonicalSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('adds an independent lower frontier without permitting forward regression', async () => {
		const networkPassphrase = 'Historical migration network';
		const canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(
			dataSource
		);
		const current = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 901,
			checkpointLedger: 191,
			networkPassphrase
		});
		await canonicalRepository.writeCheckpoint(current);

		const migration = new FullHistoryHistoricalBackfillMigration1784940000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();
		await runner.release();

		await expect(frontier(networkPassphrase)).resolves.toMatchObject({
			firstBatchId: current.batchId,
			firstLedger: '128',
			lastBatchId: current.batchId,
			nextLedger: '192'
		});

		const previous = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 902,
			checkpointLedger: 127,
			networkPassphrase
		});
		const networkHash = hashNetworkPassphrase(networkPassphrase);
		await dataSource.transaction(async (manager) => {
			await manager.query(`set local lock_timeout = '2s'`);
			await insertBatch(manager, previous, networkHash);
			await storeCanonicalFacts(manager, previous, networkHash);
			await manager.query(
				`update "full_history_watermark"
				 set "first_ledger" = $1, "first_batch_id" = $2
				 where "network_passphrase_hash" = $3`,
				[previous.firstLedger, previous.batchId, networkHash.toBuffer()]
			);
		});

		await expect(frontier(networkPassphrase)).resolves.toMatchObject({
			firstBatchId: previous.batchId,
			firstLedger: '64',
			lastBatchId: current.batchId,
			nextLedger: '192'
		});
		await expect(
			dataSource.query(
				`update "full_history_watermark" set "next_ledger" = 128
				 where "network_passphrase_hash" = $1`,
				[networkHash.toBuffer()]
			)
		).rejects.toThrow(/one contiguous frontier/i);
		await expect(frontier(networkPassphrase)).resolves.toMatchObject({
			firstLedger: '64',
			nextLedger: '192'
		});

		const next = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 903,
			checkpointLedger: 255,
			networkPassphrase
		});
		await canonicalRepository.writeCheckpoint(next);
		await expect(frontier(networkPassphrase)).resolves.toMatchObject({
			firstLedger: '64',
			lastBatchId: next.batchId,
			nextLedger: '256'
		});
	});

	it('enforces the one-to-eight checkpoint job bound in PostgreSQL', async () => {
		const networkPassphrase = 'Historical migration network';
		const networkHash = hashNetworkPassphrase(networkPassphrase).toBuffer();
		await expect(
			dataSource.query(
				`insert into "full_history_historical_backfill_job" (
					id, "network_passphrase_hash", "first_checkpoint_ledger",
					"last_checkpoint_ledger"
				 ) values ($1, $2, 63, 511)`,
				['00000000-0000-4000-8000-000000009101', networkHash]
			)
		).resolves.toHaveLength(0);
		await expect(
			dataSource.query(
				`insert into "full_history_historical_backfill_job" (
					id, "network_passphrase_hash", "first_checkpoint_ledger",
					"last_checkpoint_ledger"
				 ) values ($1, $2, 63, 575)`,
				['00000000-0000-4000-8000-000000009102', networkHash]
			)
		).rejects.toThrow(/chk_full_history_historical_backfill_range/i);
	});

	it('rolls down to the forward-only watermark without changing its upper frontier', async () => {
		const migration = new FullHistoryHistoricalBackfillMigration1784940000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await migration.down(runner);
		await runner.commitTransaction();
		await runner.release();

		const relations = (await dataSource.query(
			`select to_regclass('full_history_historical_backfill_job') as relation`
		)) as Array<{ readonly relation: string | null }>;
		expect(relations).toEqual([{ relation: null }]);
		const columns = (await dataSource.query(
			`select column_name as "columnName"
			 from information_schema.columns
			 where table_name = 'full_history_watermark'
				and column_name in ('first_ledger', 'first_batch_id')`
		)) as Array<{ readonly columnName: string }>;
		expect(columns).toEqual([]);

		const networkPassphrase = 'Historical migration network';
		const canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(
			dataSource
		);
		const next = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 904,
			checkpointLedger: 319,
			networkPassphrase
		});
		await expect(
			canonicalRepository.writeCheckpoint(next)
		).resolves.toMatchObject({
			batchId: next.batchId,
			nextLedger: '320'
		});
	});

	async function frontier(networkPassphrase: string): Promise<unknown> {
		const rows = await dataSource.query(
			`select "first_batch_id" as "firstBatchId",
				"first_ledger"::text as "firstLedger",
				"last_batch_id" as "lastBatchId",
				"next_ledger"::text as "nextLedger"
			 from "full_history_watermark"
			 where "network_passphrase_hash" = $1`,
			[hashNetworkPassphrase(networkPassphrase).toBuffer()]
		);
		return rows[0];
	}
});
