import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	type FullHistoryLedgerCloseMetaDataset
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import { FullHistoryLedgerCloseMetaRetentionMigration1785070000000 } from '../1785070000000-FullHistoryLedgerCloseMetaRetentionMigration.js';
import { FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000 } from '../1785110000000-FullHistoryLedgerCloseMetaCompleteProjectionMigration.js';

jest.setTimeout(60_000);

describe('FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await runMigration(
			new FullHistoryLedgerCloseMetaRetentionMigration1785070000000(),
			'up'
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('preserves v2 rows and accepts complete v3 projection rows', async () => {
		const migration =
			new FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000();
		await runMigration(migration, 'down');
		const source = await seedSource();
		await insertBatch(source, 3, legacyProjectionSchemas);

		await runMigration(migration, 'up');
		await insertBatch(source, 67, FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS);

		const versions = await dataSource.query<
			Array<{ readonly count: string; readonly schemaVersion: string }>
		>(`
			select count(*)::text as "count", "schema_version" as "schemaVersion"
			from "full_history_ledger_close_meta_dataset"
			where "dataset" in ('contract-events', 'ledger-entry-changes')
			group by "schema_version" order by "schema_version"
		`);
		expect(versions).toEqual([
			{
				count: '1',
				schemaVersion: 'stellar-atlas.full-history.contract-events.v2'
			},
			{
				count: '1',
				schemaVersion: 'stellar-atlas.full-history.contract-events.v3'
			},
			{
				count: '1',
				schemaVersion: 'stellar-atlas.full-history.ledger-entry-changes.v2'
			},
			{
				count: '1',
				schemaVersion: 'stellar-atlas.full-history.ledger-entry-changes.v3'
			}
		]);

		await expect(runMigration(migration, 'down')).rejects.toThrow(
			/cannot downgrade/i
		);
	});

	async function runMigration(
		migration:
			| FullHistoryLedgerCloseMetaRetentionMigration1785070000000
			| FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000,
		direction: 'down' | 'up'
	): Promise<void> {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await migration[direction](runner);
			await runner.commitTransaction();
		} catch (error) {
			await runner.rollbackTransaction();
			throw error;
		} finally {
			await runner.release();
		}
	}

	async function seedSource(): Promise<SourceFixture> {
		const source = {
			configDigest: randomBytes(32),
			id: randomUUID(),
			networkHash: randomBytes(32)
		};
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_source" (
				"id", "network_passphrase_hash", "base_uri", "config_object_key",
				"config_digest", "config_version", "compression",
				"ledgers_per_batch", "batches_per_partition", "config_bytes",
				"config_json", "first_available_ledger", "observed_at"
			) values (
				$1, $2, 'https://fixture.example', '.config.json', $3,
				'1.0', 'zstd', 1, 64000, 64, '{"version":"1.0"}'::jsonb,
				3, now()
			)`,
			[source.id, source.networkHash, source.configDigest]
		);
		return source;
	}

	async function insertBatch(
		source: SourceFixture,
		startLedger: number,
		schemas: Readonly<Record<FullHistoryLedgerCloseMetaDataset, string>>
	): Promise<void> {
		const endLedger = startLedger + 63;
		const batchId = randomUUID();
		await dataSource.transaction(async (manager) => {
			await manager.query(
				`insert into "full_history_ledger_close_meta_batch" (
					"id", "network_passphrase_hash", "source_id", "config_digest",
					"start_ledger", "end_ledger", "ledger_count",
					"first_previous_ledger_hash", "last_ledger_hash",
					"processing_manifest_sha256", "source_disposition", "processed_at"
				) values ($1, $2, $3, $4, $5, $6, 64, $7, $8, $9,
					'discarded-after-processing', now())`,
				[
					batchId,
					source.networkHash,
					source.id,
					source.configDigest,
					startLedger,
					endLedger,
					ledgerHash(startLedger - 1),
					ledgerHash(endLedger),
					randomBytes(32)
				]
			);
			await insertSourceObject(manager, source, batchId, startLedger, endLedger);
			await insertDatasets(manager, source, batchId, schemas);
		});
	}

	async function insertSourceObject(
		manager: EntityManager,
		source: SourceFixture,
		batchId: string,
		startLedger: number,
		endLedger: number
	): Promise<void> {
		await manager.query(
			`insert into "full_history_ledger_close_meta_source_object" (
				"batch_id", "network_passphrase_hash", "source_index",
				"start_ledger", "end_ledger", "ledger_count", "source_object_key",
				"source_generation", "first_previous_ledger_hash", "last_ledger_hash",
				"compressed_sha256", "xdr_sha256", "compressed_bytes", "xdr_bytes"
			) values ($1, $2, 0, $3, $4, 64, $5, $6, $7, $8, $9, $10, 100, 200)`,
			[
				batchId,
				source.networkHash,
				startLedger,
				endLedger,
				`ledger-${startLedger}-${endLedger}.xdr.zst`,
				`generation-${startLedger}`,
				ledgerHash(startLedger - 1),
				ledgerHash(endLedger),
				randomBytes(32),
				randomBytes(32)
			]
		);
	}

	async function insertDatasets(
		manager: EntityManager,
		source: SourceFixture,
		batchId: string,
		schemas: Readonly<Record<FullHistoryLedgerCloseMetaDataset, string>>
	): Promise<void> {
		for (const dataset of FULL_HISTORY_LEDGER_CLOSE_META_DATASETS) {
			const canonical = dataset === 'ledger-close-meta';
			await manager.query(
				`insert into "full_history_ledger_close_meta_dataset" (
					"batch_id", "network_passphrase_hash", "dataset", "media_type",
					"representation", "schema_version", "record_count", "output_bytes",
					"output_sha256", "storage_key"
				) values ($1, $2, $3, $4, $5, $6, $7, 64, $8, $9)`,
				[
					batchId,
					source.networkHash,
					dataset,
					canonical
						? 'application/x-stellar-ledger-close-meta-batch+xdr+zstd'
						: 'application/vnd.apache.parquet',
					canonical ? 'lossless-replay' : 'typed-projection',
					schemas[dataset],
					canonical || dataset === 'ledgers' ? 64 : 0,
					randomBytes(32),
					`typed/${batchId}/${dataset}`
				]
			);
		}
	}
});

interface SourceFixture {
	readonly configDigest: Buffer;
	readonly id: string;
	readonly networkHash: Buffer;
}

const legacyProjectionSchemas = {
	...FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	'contract-events': 'stellar-atlas.full-history.contract-events.v2',
	'ledger-entry-changes':
		'stellar-atlas.full-history.ledger-entry-changes.v2'
} satisfies Readonly<Record<FullHistoryLedgerCloseMetaDataset, string>>;

function ledgerHash(sequence: number): Buffer {
	return createHash('sha256').update(`ledger:${sequence}`).digest();
}
