import type { EntityManager } from 'typeorm';
import {
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaProcessedBatchCommit } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaManifest.js';

interface BatchRow {
	readonly configDigest: Buffer;
	readonly firstPreviousLedgerHash: Buffer;
	readonly id: string;
	readonly lastLedgerHash: Buffer;
	readonly ledgerCount: number;
	readonly manifestSha256: Buffer;
	readonly sourceDisposition: string;
	readonly sourceId: string;
}

interface SourceObjectRow {
	readonly compressedBytes: string;
	readonly compressedSha256: Buffer;
	readonly endLedger: string;
	readonly firstPreviousLedgerHash: Buffer;
	readonly generation: string;
	readonly ledgerCount: number;
	readonly lastLedgerHash: Buffer;
	readonly objectKey: string;
	readonly sourceEtag: string | null;
	readonly sourceIndex: number;
	readonly startLedger: string;
	readonly xdrBytes: string;
	readonly xdrSha256: Buffer;
}

interface DatasetRow {
	readonly byteCount: string;
	readonly dataset: string;
	readonly mediaType: string;
	readonly recordCount: string;
	readonly representation: string;
	readonly schemaVersion: string;
	readonly sha256: Buffer;
	readonly storageKey: string;
}

export async function findAndVerifyFullHistoryLedgerCloseMetaBatch(
	manager: EntityManager,
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit,
	networkHash: Buffer
): Promise<string | null> {
	const range = batch.processing.range;
	const rows = await manager.query<BatchRow[]>(
		`select "id", "source_id" as "sourceId", "config_digest" as "configDigest",
			"ledger_count" as "ledgerCount",
			"first_previous_ledger_hash" as "firstPreviousLedgerHash",
			"last_ledger_hash" as "lastLedgerHash",
			"processing_manifest_sha256" as "manifestSha256",
			"source_disposition" as "sourceDisposition"
		 from "full_history_ledger_close_meta_batch"
		 where "network_passphrase_hash" = $1
			and "start_ledger" = $2 and "end_ledger" = $3`,
		[networkHash, range.startSequence, range.endSequence]
	);
	if (rows.length === 0) return null;
	if (rows.length !== 1)
		throw new Error('Duplicate LedgerCloseMeta shard range');
	const row = rows[0]!;
	const boundaries = batchBoundaries(batch);
	if (
		row.sourceId !== batch.source.sourceId ||
		digest(row.configDigest) !== batch.source.configDigest ||
		row.ledgerCount !== range.ledgerCount ||
		digest(row.firstPreviousLedgerHash) !==
			boundaries.firstPreviousLedgerHash ||
		digest(row.lastLedgerHash) !== boundaries.lastLedgerHash ||
		digest(row.manifestSha256) !== batch.processing.manifestSha256 ||
		row.sourceDisposition !== batch.processing.sourceDisposition
	) {
		throw new Error('Competing LedgerCloseMeta typed shard manifest');
	}
	await assertSourceObjects(manager, row.id, batch);
	await assertDatasets(manager, row.id, batch);
	return row.id;
}

export async function insertFullHistoryLedgerCloseMetaBatch(
	manager: EntityManager,
	batchId: string,
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit,
	networkHash: Buffer
): Promise<void> {
	const range = batch.processing.range;
	const boundaries = batchBoundaries(batch);
	await manager.query(
		`insert into "full_history_ledger_close_meta_batch" (
			"id", "network_passphrase_hash", "source_id", "config_digest",
			"start_ledger", "end_ledger", "ledger_count",
			"first_previous_ledger_hash", "last_ledger_hash",
			"processing_manifest_sha256", "source_disposition", "processed_at"
		) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		[
			batchId,
			networkHash,
			batch.source.sourceId,
			digestBuffer(batch.source.configDigest),
			range.startSequence,
			range.endSequence,
			range.ledgerCount,
			digestBuffer(boundaries.firstPreviousLedgerHash),
			digestBuffer(boundaries.lastLedgerHash),
			digestBuffer(batch.processing.manifestSha256),
			batch.processing.sourceDisposition,
			batch.processedAt
		]
	);
	await insertSourceObjects(manager, batchId, batch, networkHash);
	await insertDatasets(manager, batchId, batch, networkHash);
}

async function insertSourceObjects(
	manager: EntityManager,
	batchId: string,
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit,
	networkHash: Buffer
): Promise<void> {
	for (const [index, source] of batch.processing.sourceObjects.entries()) {
		await manager.query(
			`insert into "full_history_ledger_close_meta_source_object" (
				"batch_id", "network_passphrase_hash", "source_index",
				"start_ledger", "end_ledger", "ledger_count",
				"source_object_key", "source_generation", "source_etag",
				"first_previous_ledger_hash", "last_ledger_hash",
				"compressed_sha256", "xdr_sha256", "compressed_bytes", "xdr_bytes"
			) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			[
				batchId,
				networkHash,
				index,
				source.range.startSequence,
				source.range.endSequence,
				source.range.ledgerCount,
				source.objectKey,
				source.generation,
				source.etag ?? null,
				digestBuffer(source.firstPreviousLedgerHash),
				digestBuffer(source.lastLedgerHash),
				digestBuffer(source.compressedSha256),
				digestBuffer(source.xdrSha256),
				source.compressedByteCount,
				source.xdrByteCount
			]
		);
	}
}

async function insertDatasets(
	manager: EntityManager,
	batchId: string,
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit,
	networkHash: Buffer
): Promise<void> {
	for (const output of batch.processing.outputs) {
		await manager.query(
			`insert into "full_history_ledger_close_meta_dataset" (
				"batch_id", "network_passphrase_hash", "dataset", "media_type", "representation", "schema_version",
				"record_count", "output_bytes", "output_sha256", "storage_key"
			) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			[
				batchId,
				networkHash,
				output.dataset,
				output.mediaType,
				output.representation,
				output.schemaVersion,
				output.recordCount,
				output.byteCount,
				digestBuffer(output.sha256),
				output.storageKey
			]
		);
	}
}

async function assertSourceObjects(
	manager: EntityManager,
	batchId: string,
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
): Promise<void> {
	const rows = await manager.query<SourceObjectRow[]>(
		`select "source_index" as "sourceIndex",
			"start_ledger"::text as "startLedger", "end_ledger"::text as "endLedger",
			"ledger_count" as "ledgerCount", "source_object_key" as "objectKey",
			"source_generation" as "generation", "source_etag" as "sourceEtag",
			"first_previous_ledger_hash" as "firstPreviousLedgerHash",
			"last_ledger_hash" as "lastLedgerHash",
			"compressed_sha256" as "compressedSha256", "xdr_sha256" as "xdrSha256",
			"compressed_bytes"::text as "compressedBytes", "xdr_bytes"::text as "xdrBytes"
		 from "full_history_ledger_close_meta_source_object"
		 where "batch_id" = $1 order by "source_index"`,
		[batchId]
	);
	const expected = batch.processing.sourceObjects;
	if (rows.length !== expected.length) throw competingSourceObjects();
	for (const [index, row] of rows.entries()) {
		const source = expected[index]!;
		if (
			row.sourceIndex !== index ||
			Number(row.startLedger) !== source.range.startSequence ||
			Number(row.endLedger) !== source.range.endSequence ||
			row.ledgerCount !== source.range.ledgerCount ||
			row.objectKey !== source.objectKey ||
			row.generation !== source.generation ||
			row.sourceEtag !== (source.etag ?? null) ||
			digest(row.firstPreviousLedgerHash) !== source.firstPreviousLedgerHash ||
			digest(row.lastLedgerHash) !== source.lastLedgerHash ||
			digest(row.compressedSha256) !== source.compressedSha256 ||
			digest(row.xdrSha256) !== source.xdrSha256 ||
			Number(row.compressedBytes) !== source.compressedByteCount ||
			Number(row.xdrBytes) !== source.xdrByteCount
		) {
			throw competingSourceObjects();
		}
	}
}

async function assertDatasets(
	manager: EntityManager,
	batchId: string,
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
): Promise<void> {
	const rows = await manager.query<DatasetRow[]>(
		`select "dataset", "media_type" as "mediaType", "representation", "schema_version" as "schemaVersion",
			"record_count"::text as "recordCount", "output_bytes"::text as "byteCount",
			"output_sha256" as "sha256", "storage_key" as "storageKey"
		 from "full_history_ledger_close_meta_dataset"
		 where "batch_id" = $1 order by "dataset"`,
		[batchId]
	);
	const actual = rows.map(datasetIdentity);
	const expected = batch.processing.outputs.map(outputIdentity).sort();
	if (actual.join('|') !== expected.join('|')) {
		throw new Error('Competing LedgerCloseMeta typed output manifest');
	}
}

function competingSourceObjects(): Error {
	return new Error('Competing LedgerCloseMeta source-object provenance');
}

function datasetIdentity(row: DatasetRow): string {
	return `${row.dataset}:${row.mediaType}:${row.representation}:${row.schemaVersion}:${row.recordCount}:${row.byteCount}:${digest(row.sha256)}:${row.storageKey}`;
}

function outputIdentity(
	output: FullHistoryLedgerCloseMetaProcessedBatchCommit['processing']['outputs'][number]
): string {
	return `${output.dataset}:${output.mediaType}:${output.representation}:${output.schemaVersion}:${output.recordCount}:${output.byteCount}:${output.sha256}:${output.storageKey}`;
}

function batchBoundaries(
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
): {
	readonly firstPreviousLedgerHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly lastLedgerHash: FullHistoryLedgerCloseMetaSha256Digest;
} {
	const first = batch.processing.sourceObjects[0];
	const last = batch.processing.sourceObjects.at(-1);
	if (first === undefined || last === undefined) {
		throw new Error('LedgerCloseMeta shard has no source-object boundaries');
	}
	return {
		firstPreviousLedgerHash: first.firstPreviousLedgerHash,
		lastLedgerHash: last.lastLedgerHash
	};
}

function digestBuffer(value: FullHistoryLedgerCloseMetaSha256Digest): Buffer {
	return Buffer.from(fullHistoryLedgerCloseMetaSha256Digest(value), 'hex');
}

function digest(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		Buffer.from(value).toString('hex')
	);
}
