import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryLedgerCloseMetaProcessedBatchCommit,
	FullHistoryLedgerCloseMetaRegisteredSource,
	FullHistoryLedgerCloseMetaSourceRegistration
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaManifest.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE,
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import { StellarLedgerCloseMetaBatchDecoder } from '../../../full-history-ledger-close-meta/StellarLedgerCloseMetaBatchDecoder.js';
import { ledgerCloseMetaBatchFixture } from '../../../full-history-ledger-close-meta/__tests__/LedgerCloseMetaBatchTestFixture.js';
import { FullHistoryLedgerCloseMetaRetentionMigration1785070000000 } from '../../migrations/1785070000000-FullHistoryLedgerCloseMetaRetentionMigration.js';
import { FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000 } from '../../migrations/1785110000000-FullHistoryLedgerCloseMetaCompleteProjectionMigration.js';
import { FullHistoryLedgerCloseMetaStateProjectionMigration1785120000000 } from '../../migrations/1785120000000-FullHistoryLedgerCloseMetaStateProjectionMigration.js';
import { FullHistoryLedgerTwoBootstrapMigration1785600000000 } from '../../migrations/1785600000000-FullHistoryLedgerTwoBootstrapMigration.js';
import { TypeOrmFullHistoryLedgerCloseMetaManifestRepository } from '../TypeOrmFullHistoryLedgerCloseMetaManifestRepository.js';

jest.setTimeout(60_000);

describe('TypeOrm full-history ledger-two bootstrap', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryLedgerCloseMetaManifestRepository;
	const passphrase = 'Public ledger-two integration fixture';
	const decoder = new StellarLedgerCloseMetaBatchDecoder({
		maximumCompressedBytes: 1_000_000,
		maximumUncompressedBytes: 2_000_000
	});

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await new FullHistoryLedgerCloseMetaRetentionMigration1785070000000().up(
			runner
		);
		await new FullHistoryLedgerCloseMetaCompleteProjectionMigration1785110000000().up(
			runner
		);
		await new FullHistoryLedgerCloseMetaStateProjectionMigration1785120000000().up(
			runner
		);
		await new FullHistoryLedgerTwoBootstrapMigration1785600000000().up(runner);
		await runner.commitTransaction();
		await runner.release();
		repository = new TypeOrmFullHistoryLedgerCloseMetaManifestRepository(
			dataSource
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('prepends exactly ledger 2 without moving the forward watermark', async () => {
		const sourceThree = await repository.registerSource(
			sourceRegistration(3, 'galexie')
		);
		await expect(
			repository.commitProcessedBatch(processedBatch(sourceThree, 3, 66))
		).resolves.toMatchObject({ nextLedger: 67 });

		const sourceTwo = await repository.registerSource(
			sourceRegistration(2, 'genesis-history')
		);
		const ledgerTwo = processedBatch(sourceTwo, 2, 2);
		const receipt = await repository.commitLedgerTwoBootstrap(ledgerTwo);
		expect(receipt).toMatchObject({
			nextLedger: 67,
			replayed: false
		});
		await expect(
			repository.commitLedgerTwoBootstrap(ledgerTwo)
		).resolves.toMatchObject({
			batchId: receipt.batchId,
			nextLedger: 67,
			replayed: true
		});

		const [watermark] = await dataSource.query<
			Array<{
				readonly firstLedger: string;
				readonly nextLedger: string;
			}>
		>(
			`select "first_available_ledger"::text as "firstLedger",
				"next_ledger"::text as "nextLedger"
			 from "full_history_ledger_close_meta_watermark"`
		);
		expect(watermark).toEqual({ firstLedger: '2', nextLedger: '67' });
	});

	function processedBatch(
		source: FullHistoryLedgerCloseMetaRegisteredSource,
		start: number,
		end: number
	): FullHistoryLedgerCloseMetaProcessedBatchCommit {
		const fixture = ledgerCloseMetaBatchFixture(
			start,
			end,
			Array.from({ length: end - start + 1 }, (_, index) => start + index)
		);
		const decoded = decoder.decode({
			compressedPayload: fixture.compressed,
			expectedRange: {
				endSequence: fullHistoryLedgerCloseMetaSequence(end),
				ledgerCount: end - start + 1,
				startSequence: fullHistoryLedgerCloseMetaSequence(start)
			}
		});
		const ledgerCount = end - start + 1;
		return {
			processedAt: new Date('2026-08-27T00:02:00.000Z'),
			processing: {
				manifestSha256: digest(`manifest:${start}-${end}`),
				outputs: FULL_HISTORY_LEDGER_CLOSE_META_DATASETS.map((dataset) => ({
					byteCount: 50,
					dataset,
					mediaType:
						dataset === 'ledger-close-meta'
							? FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE
							: FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
					recordCount:
						dataset === 'ledger-close-meta' || dataset === 'ledgers'
							? ledgerCount
							: 0,
					representation:
						dataset === 'ledger-close-meta'
							? 'lossless-replay'
							: 'typed-projection',
					schemaVersion:
						FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS[dataset],
					sha256: digest(`output:${start}-${end}:${dataset}`),
					storageKey: `typed/${start}-${end}/${dataset}`
				})),
				range: {
					endSequence: fullHistoryLedgerCloseMetaSequence(end),
					ledgerCount,
					startSequence: fullHistoryLedgerCloseMetaSequence(start)
				},
				sourceDisposition: FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION,
				sourceObjects: [
					{
						...decoded,
						firstPreviousLedgerHash: ledgerHash(start - 1),
						generation: `fixture-${start}-${end}`,
						lastLedgerHash: ledgerHash(end),
						objectKey: `ledger-${start}-${end}.xdr.zst`
					}
				]
			},
			source
		};
	}

	function sourceRegistration(
		firstAvailableLedger: number,
		name: string
	): FullHistoryLedgerCloseMetaSourceRegistration {
		const config = Object.freeze({
			batchesPerPartition: 64_000,
			compression: 'zstd' as const,
			ledgersPerBatch: 1,
			networkPassphrase: passphrase,
			version: name
		});
		const bytes = Buffer.from(JSON.stringify(config), 'utf8');
		return {
			config,
			configDigest: sha256(bytes),
			configObject: {
				bytes,
				identity: {
					generation: name,
					objectKey: `${name}/.config.json`,
					sourceUri: `https://${name}.example/.config.json`
				}
			},
			firstAvailableLedger:
				fullHistoryLedgerCloseMetaSequence(firstAvailableLedger),
			networkPassphraseHash: sha256(Buffer.from(passphrase, 'utf8')),
			observedAt: new Date('2026-08-27T00:00:00.000Z'),
			source: {
				ledgersPath: name,
				sourceUri: `https://${name}.example`
			}
		};
	}
});

function ledgerHash(sequence: number) {
	return digest(`ledger:${sequence}`);
}

function digest(value: string) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}

function sha256(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}
