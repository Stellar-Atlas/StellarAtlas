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
import { TypeOrmFullHistoryLedgerCloseMetaManifestRepository } from '../TypeOrmFullHistoryLedgerCloseMetaManifestRepository.js';

jest.setTimeout(60_000);

describe('TypeOrmFullHistoryLedgerCloseMetaManifestRepository', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryLedgerCloseMetaManifestRepository;
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

	it('registers AWS ledger 3 as the network origin idempotently', async () => {
		const registration = sourceRegistration();
		const first = await repository.registerSource(registration);
		const replay = await repository.registerSource({
			...registration,
			observedAt: new Date('2026-07-14T00:01:00.000Z')
		});
		expect(replay).toEqual(first);
		expect(first).toEqual(
			expect.objectContaining({
				firstAvailableLedger: 3,
				nextLedger: 3,
				watermarkVersion: 0
			})
		);
	});

	it('commits typed output metadata and replays it exactly', async () => {
		const source = await repository.registerSource(sourceRegistration(11));
		const batch = processedBatch(source, 3, 12);
		await expect(repository.commitProcessedBatch(batch)).resolves.toEqual(
			expect.objectContaining({
				nextLedger: 67,
				replayed: false,
				watermarkVersion: 1
			})
		);
		await expect(repository.commitProcessedBatch(batch)).resolves.toEqual(
			expect.objectContaining({
				nextLedger: 67,
				replayed: true,
				watermarkVersion: 1
			})
		);
		await expect(repository.readStoredBytes()).resolves.toBe(400n);
	});

	it('stores a near-tip gap without overstating contiguous coverage', async () => {
		const source = await repository.registerSource(sourceRegistration(21));
		await expect(
			repository.commitProcessedBatch(processedBatch(source, 131, 22))
		).resolves.toEqual(
			expect.objectContaining({ nextLedger: 3, watermarkVersion: 0 })
		);
		await repository.commitProcessedBatch(processedBatch(source, 3, 24));
		await expect(
			repository.commitProcessedBatch(processedBatch(source, 67, 26))
		).resolves.toEqual(
			expect.objectContaining({ nextLedger: 195, watermarkVersion: 3 })
		);
	});

	it('rejects competing typed output for an existing range', async () => {
		const source = await repository.registerSource(sourceRegistration(31));
		const first = processedBatch(source, 3, 32);
		await repository.commitProcessedBatch(first);
		await expect(
			repository.commitProcessedBatch({
				...first,
				processing: {
					...first.processing,
					manifestSha256: digest(34)
				}
			})
		).rejects.toThrow(/competing/i);
	});

	function processedBatch(
		source: FullHistoryLedgerCloseMetaRegisteredSource,
		sequence: number,
		seed: number
	): FullHistoryLedgerCloseMetaProcessedBatchCommit {
		const sourceRanges = [
			[sequence, sequence + 31],
			[sequence + 32, sequence + 63]
		] as const;
		const sources = sourceRanges.map(([start, end], index) => {
			const fixture = ledgerCloseMetaBatchFixture(
				start,
				end,
				Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
			);
			const decoded = decoder.decode({
				compressedPayload: fixture.compressed,
				expectedRange: {
					endSequence: fullHistoryLedgerCloseMetaSequence(end),
					ledgerCount: end - start + 1,
					startSequence: fullHistoryLedgerCloseMetaSequence(start)
				}
			});
			return {
				...decoded,
				etag: `etag-${seed}-${index}`,
				firstPreviousLedgerHash: ledgerHash(start - 1),
				generation: `generation-${seed}-${index}`,
				lastLedgerHash: ledgerHash(end),
				objectKey: `ledger-${start}-${end}.xdr.zst`
			};
		});
		return {
			processedAt: new Date('2026-07-14T00:02:00.000Z'),
			processing: {
				manifestSha256: digest(seed),
				outputs: FULL_HISTORY_LEDGER_CLOSE_META_DATASETS.map((dataset) => ({
					byteCount: 50,
					dataset,
					mediaType:
						dataset === 'ledger-close-meta'
							? FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE
							: FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
					representation:
						dataset === 'ledger-close-meta'
							? 'lossless-replay'
							: 'typed-projection',
					recordCount:
						dataset === 'ledger-close-meta' || dataset === 'ledgers' ? 64 : 0,
					schemaVersion: FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS[dataset],
					sha256: digest(seed + 1),
					storageKey: `typed/${source.sourceId}/${sequence}/${dataset}`
				})),
				range: {
					endSequence: fullHistoryLedgerCloseMetaSequence(sequence + 63),
					ledgerCount: 64,
					startSequence: fullHistoryLedgerCloseMetaSequence(sequence)
				},
				sourceDisposition: FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION,
				sourceObjects: sources
			},
			source
		};
	}

	function sourceRegistration(
		seed = 1
	): FullHistoryLedgerCloseMetaSourceRegistration {
		const config = Object.freeze({
			batchesPerPartition: 64_000,
			compression: 'zstd' as const,
			ledgersPerBatch: 1,
			networkPassphrase: `Public fixture network ${seed}`,
			version: '1.0'
		});
		const bytes = Buffer.from(JSON.stringify(config), 'utf8');
		return {
			config,
			configDigest: sha256(bytes),
			configObject: {
				bytes,
				identity: {
					etag: `etag-${seed}`,
					generation: `generation-${seed}`,
					objectKey: `v1.${seed}/stellar/ledgers/pubnet/.config.json`,
					sourceUri: `https://aws.example/v1.${seed}/stellar/ledgers/pubnet/.config.json`
				}
			},
			firstAvailableLedger: fullHistoryLedgerCloseMetaSequence(3),
			networkPassphraseHash: sha256(
				Buffer.from(config.networkPassphrase, 'utf8')
			),
			observedAt: new Date('2026-07-14T00:00:00.000Z'),
			source: {
				ledgersPath: `v1.${seed}/stellar/ledgers/pubnet`,
				sourceUri: 'https://aws.example'
			}
		};
	}
});

function digest(seed: number) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		Buffer.alloc(32, seed).toString('hex')
	);
}

function ledgerHash(sequence: number) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(`fixture-ledger:${sequence}`).digest('hex')
	);
}

function sha256(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}
