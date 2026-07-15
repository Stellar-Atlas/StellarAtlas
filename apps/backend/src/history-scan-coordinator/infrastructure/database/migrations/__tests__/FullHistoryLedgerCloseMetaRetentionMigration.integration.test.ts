import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS } from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import { FullHistoryLedgerCloseMetaRetentionMigration1785070000000 } from '../1785070000000-FullHistoryLedgerCloseMetaRetentionMigration.js';
import {
	ledgerHash,
	legacySchemaVersions,
	type BatchFixture,
	type DatasetFixtureOptions,
	type SourceFixture
} from './FullHistoryLedgerCloseMetaRetentionMigrationFixtures.js';
jest.setTimeout(60_000);
describe('FullHistoryLedgerCloseMetaRetentionMigration1785070000000', () => {
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

	it('stores typed output manifests without source payload bytes', async () => {
		const migration =
			new FullHistoryLedgerCloseMetaRetentionMigration1785070000000();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await expect(migration.up(runner)).rejects.toThrow(/active transaction/i);
		await runner.startTransaction();
		await migration.up(runner);
		await runner.commitTransaction();
		await runner.release();

		await expect(
			columns('full_history_ledger_close_meta_dataset')
		).resolves.toEqual(
			expect.arrayContaining([
				'dataset',
				'media_type',
				'output_bytes',
				'output_sha256',
				'record_count',
				'representation',
				'schema_version',
				'storage_key'
			])
		);
		const allColumns = [
			...(await columns('full_history_ledger_close_meta_source')),
			...(await columns('full_history_ledger_close_meta_batch')),
			...(await columns('full_history_ledger_close_meta_source_object')),
			...(await columns('full_history_ledger_close_meta_dataset')),
			...(await columns('full_history_ledger_close_meta_watermark'))
		];
		expect(
			allColumns.some((column) =>
				/payload|pack|raw_bytes|xdr_payload/.test(column)
			)
		).toBe(false);
	});

	it('starts at the first ledger and advances one contiguous processed batch', async () => {
		const source = await seedSource();
		await insertWatermark(source, 3);
		const batchId = randomUUID();
		await insertBatch(source, {
			batchId,
			endLedger: 66,
			seed: 3,
			startLedger: 3
		});
		await dataSource.query(
			`update "full_history_ledger_close_meta_watermark"
			 set "last_batch_id" = $2, "next_ledger" = 67,
				"version" = "version" + 1, "updated_at" = now()
			 where "network_passphrase_hash" = $1 and "version" = 0`,
			[source.networkHash, batchId]
		);
		const rows = await dataSource.query<
			Array<{ readonly nextLedger: string; readonly version: string }>
		>(
			`select "next_ledger" as "nextLedger", "version"
			 from "full_history_ledger_close_meta_watermark"
			 where "network_passphrase_hash" = $1`,
			[source.networkHash]
		);
		expect(rows).toEqual([{ nextLedger: '67', version: '1' }]);
	});

	it('rejects manifest mutation and overlapping processed ranges', async () => {
		const source = await seedSource();
		const batchId = randomUUID();
		await insertBatch(source, {
			batchId,
			endLedger: 72,
			seed: 5,
			startLedger: 9
		});
		await expect(
			dataSource.query(
				`update "full_history_ledger_close_meta_source_object"
				 set "source_generation" = 'changed' where "batch_id" = $1`,
				[batchId]
			)
		).rejects.toThrow(/immutable/i);
		await expect(
			insertBatch(source, {
				batchId: randomUUID(),
				endLedger: 75,
				seed: 7,
				startLedger: 12
			})
		).rejects.toThrow(/overlap/i);
		await expect(
			dataSource.query(
				`update "full_history_ledger_close_meta_source"
				 set "base_uri" = 'https://changed.example' where "id" = $1`,
				[source.id]
			)
		).rejects.toThrow(/immutable/i);
	});

	it('rejects a ledger-hash discontinuity inside or between typed shards', async () => {
		const source = await seedSource();
		await insertBatch(source, {
			batchId: randomUUID(),
			endLedger: 66,
			seed: 40,
			startLedger: 3
		});
		await expect(
			insertBatch(source, {
				batchId: randomUUID(),
				endLedger: 130,
				firstPreviousLedgerHash: Buffer.alloc(32, 99),
				seed: 42,
				startLedger: 67
			})
		).rejects.toThrow(/predecessor hash/i);
		await expect(
			insertBatch(source, {
				batchId: randomUUID(),
				endLedger: 194,
				seed: 44,
				sourceHashGapAt: 163,
				startLedger: 131
			})
		).rejects.toThrow(/source objects.*cover/i);
	});

	it('rejects a reverse-order successor hash discontinuity', async () => {
		const source = await seedSource();
		await insertBatch(source, {
			batchId: randomUUID(),
			endLedger: 130,
			firstPreviousLedgerHash: Buffer.alloc(32, 97),
			seed: 50,
			startLedger: 67
		});
		await expect(
			insertBatch(source, {
				batchId: randomUUID(),
				endLedger: 66,
				seed: 51,
				startLedger: 3
			})
		).rejects.toThrow(/successor hash/i);
	});

	it('rejects a watermark jump over a missing processed range', async () => {
		const source = await seedSource();
		await insertWatermark(source, 3);
		const batchId = randomUUID();
		await insertBatch(source, {
			batchId,
			endLedger: 130,
			seed: 9,
			startLedger: 67
		});
		await expect(
			dataSource.query(
				`update "full_history_ledger_close_meta_watermark"
				 set "last_batch_id" = $2, "next_ledger" = 131, "version" = 1
				 where "network_passphrase_hash" = $1`,
				[source.networkHash, batchId]
			)
		).rejects.toThrow(/contiguous batch/i);
	});

	it('rejects a typed shard whose source evidence does not cover its range', async () => {
		const source = await seedSource();
		await expect(
			dataSource.transaction(async (manager) => {
				const batchId = randomUUID();
				await manager.query(
					`insert into "full_history_ledger_close_meta_batch" (
						"id", "network_passphrase_hash", "source_id", "config_digest",
						"start_ledger", "end_ledger", "ledger_count",
					"first_previous_ledger_hash", "last_ledger_hash",
					"processing_manifest_sha256", "source_disposition", "processed_at"
					) values (
					$1, $2, $3, $4, 20, 83, 64, $5, $6, $7,
					'discarded-after-processing', now()
					)`,
					[
						batchId,
						source.networkHash,
						source.id,
						source.configDigest,
						ledgerHash(19),
						ledgerHash(83),
						Buffer.alloc(32, 20)
					]
				);
				await manager.query(
					`insert into "full_history_ledger_close_meta_source_object" (
						"batch_id", "network_passphrase_hash", "source_index",
						"start_ledger", "end_ledger", "ledger_count",
						"source_object_key", "source_generation",
						"first_previous_ledger_hash", "last_ledger_hash",
						"compressed_sha256", "xdr_sha256", "compressed_bytes", "xdr_bytes"
					) values ($1, $2, 0, 20, 20, 1, $3, $4, $5, $6, $7, $8, 100, 200)`,
					[
						batchId,
						source.networkHash,
						'ledger-20.xdr.zst',
						'generation-20',
						ledgerHash(19),
						ledgerHash(20),
						Buffer.alloc(32, 20),
						Buffer.alloc(32, 21)
					]
				);
				await insertDatasets(manager, source, batchId, 64, 20);
			})
		).rejects.toThrow(/source objects.*cover/i);
	});

	it('rejects missing or misrepresented durable outputs', async () => {
		const source = await seedSource();
		await expect(
			dataSource.transaction(async (manager) => {
				const batchId = randomUUID();
				await insertBatchRow(manager, source, {
					batchId,
					endLedger: 66,
					seed: 60,
					startLedger: 3
				});
				await insertSourceCoverage(manager, source, {
					batchId,
					endLedger: 66,
					seed: 60,
					startLedger: 3
				});
				await insertDatasets(manager, source, batchId, 64, 60, {
					skip: 'contract-events'
				});
			})
		).rejects.toThrow(/exact durable output set/i);

		await expect(
			insertBatch(source, {
				batchId: randomUUID(),
				endLedger: 130,
				misrepresent: 'ledger-close-meta',
				seed: 61,
				startLedger: 67
			})
		).rejects.toThrow(/dataset_contract/i);
	});

	it.each([
		[65, 70],
		[1_027, 71]
	])('rejects a typed batch ending at %i', async (endLedger, seed) => {
		const source = await seedSource();
		await expect(
			insertBatchRow(dataSource.manager, source, {
				batchId: randomUUID(),
				endLedger,
				seed,
				startLedger: 3
			})
		).rejects.toThrow(/batch_range/i);
	});

	async function seedSource(): Promise<SourceFixture> {
		const fixture = {
			configDigest: randomBytes(32),
			id: randomUUID(),
			networkHash: randomBytes(32)
		};
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_source" (
				"id", "network_passphrase_hash", "base_uri",
				"config_object_key", "config_digest", "config_version",
				"compression", "ledgers_per_batch", "batches_per_partition",
				"config_bytes", "config_json", "first_available_ledger",
				"observed_at"
			) values (
				$1, $2, $3, $4, $5, '1.0', 'zstd', 1, 64000,
				128, $6::jsonb, 3, now()
			)`,
			[
				fixture.id,
				fixture.networkHash,
				`https://fixture-${fixture.id}.example`,
				'v1.1/stellar/ledgers/pubnet/.config.json',
				fixture.configDigest,
				JSON.stringify({ compression: 'zstd', version: '1.0' })
			]
		);
		return fixture;
	}

	async function insertWatermark(
		source: SourceFixture,
		firstAvailableLedger: number
	): Promise<void> {
		await dataSource.query(
			`insert into "full_history_ledger_close_meta_watermark" (
				"network_passphrase_hash", "first_available_ledger", "next_ledger"
			) values ($1, $2, $2)`,
			[source.networkHash, firstAvailableLedger]
		);
	}

	async function insertBatch(
		source: SourceFixture,
		input: BatchFixture
	): Promise<void> {
		await dataSource.transaction(async (manager) => {
			await insertBatchRow(manager, source, input);
			await insertSourceCoverage(manager, source, input);
			await insertDatasets(
				manager,
				source,
				input.batchId,
				input.endLedger - input.startLedger + 1,
				input.seed,
				input.misrepresent === undefined
					? {}
					: { misrepresent: input.misrepresent }
			);
		});
	}

	async function insertBatchRow(
		manager: EntityManager,
		source: SourceFixture,
		input: BatchFixture
	): Promise<void> {
		await manager.query(
			`insert into "full_history_ledger_close_meta_batch" (
					"id", "network_passphrase_hash", "source_id", "config_digest",
					"start_ledger", "end_ledger", "ledger_count",
					"first_previous_ledger_hash", "last_ledger_hash",
					"processing_manifest_sha256", "source_disposition", "processed_at"
				) values (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
					'discarded-after-processing', now()
				)`,
			[
				input.batchId,
				source.networkHash,
				source.id,
				source.configDigest,
				input.startLedger,
				input.endLedger,
				input.endLedger - input.startLedger + 1,
				input.firstPreviousLedgerHash ?? ledgerHash(input.startLedger - 1),
				ledgerHash(input.endLedger),
				Buffer.alloc(32, input.seed + 2)
			]
		);
	}

	async function insertSourceCoverage(
		manager: EntityManager,
		source: SourceFixture,
		input: BatchFixture
	): Promise<void> {
		const split = input.sourceHashGapAt;
		const ranges =
			split === undefined
				? [[input.startLedger, input.endLedger] as const]
				: [
						[input.startLedger, split - 1] as const,
						[split, input.endLedger] as const
					];
		for (const [index, range] of ranges.entries()) {
			const [start, end] = range;
			await manager.query(
				`insert into "full_history_ledger_close_meta_source_object" (
						"batch_id", "network_passphrase_hash", "source_index",
						"start_ledger", "end_ledger", "ledger_count",
						"source_object_key", "source_generation",
						"first_previous_ledger_hash", "last_ledger_hash",
						"compressed_sha256", "xdr_sha256", "compressed_bytes", "xdr_bytes"
					) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 100, 200)`,
				[
					input.batchId,
					source.networkHash,
					index,
					start,
					end,
					end - start + 1,
					`ledger-${start}-${end}.xdr.zst`,
					`generation-${input.seed}-${start}`,
					index === 1
						? Buffer.alloc(32, 98)
						: (input.firstPreviousLedgerHash ?? ledgerHash(start - 1)),
					ledgerHash(end),
					Buffer.alloc(32, input.seed),
					Buffer.alloc(32, input.seed + 1)
				]
			);
		}
	}

	async function insertDatasets(
		manager: EntityManager,
		source: SourceFixture,
		batchId: string,
		ledgerCount: number,
		seed: number,
		options: DatasetFixtureOptions = {}
	): Promise<void> {
		for (const dataset of FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS) {
			if (dataset === options.skip) continue;
			const canonical = dataset === 'ledger-close-meta';
			const misrepresented = dataset === options.misrepresent;
			await manager.query(
				`insert into "full_history_ledger_close_meta_dataset" (
				"batch_id", "network_passphrase_hash", "dataset", "media_type",
				"representation", "schema_version", "record_count", "output_bytes", "output_sha256",
				"storage_key"
			) values ($1, $2, $3, $4, $5, $6, $7, 64, $8, $9)`,
				[
					batchId,
					source.networkHash,
					dataset,
					canonical && !misrepresented
						? 'application/x-stellar-ledger-close-meta-batch+xdr+zstd'
						: 'application/vnd.apache.parquet',
					canonical ? 'lossless-replay' : 'typed-projection',
					legacySchemaVersions[dataset],
					dataset === 'ledger-close-meta' || dataset === 'ledgers'
						? ledgerCount
						: dataset === 'transactions' ||
							  dataset === 'transaction-results' ||
							  dataset === 'transaction-meta'
							? 3
							: 0,
					Buffer.alloc(32, seed),
					`typed/${dataset}/${batchId}`
				]
			);
		}
	}

	async function columns(tableName: string): Promise<string[]> {
		const rows = await dataSource.query<Array<{ readonly columnName: string }>>(
			`select column_name as "columnName" from information_schema.columns
			 where table_schema = current_schema() and table_name = $1
			 order by column_name`,
			[tableName]
		);
		return rows.map((row) => row.columnName);
	}
});
