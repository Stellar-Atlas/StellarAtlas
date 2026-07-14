import { createHash, randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
	fullHistoryLedgerCloseMetaSequence,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryLedgerCloseMetaBatchCommitReceipt,
	FullHistoryLedgerCloseMetaManifestRepository,
	FullHistoryLedgerCloseMetaProcessedBatchCommit,
	FullHistoryLedgerCloseMetaRegisteredSource,
	FullHistoryLedgerCloseMetaSourceRegistration
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaManifest.js';
import { assertFullHistoryLedgerCloseMetaProcessingReceipt } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import {
	findAndVerifyFullHistoryLedgerCloseMetaBatch,
	insertFullHistoryLedgerCloseMetaBatch
} from './TypeOrmFullHistoryLedgerCloseMetaBatchStore.js';

interface SourceRow {
	readonly configDigest: Buffer;
	readonly firstAvailableLedger: string;
	readonly id: string;
	readonly networkPassphraseHash: Buffer;
}

interface WatermarkRow {
	readonly firstAvailableLedger: string;
	readonly nextLedger: string;
	readonly version: string;
}

interface ContiguousBatchRow {
	readonly endLedger: string;
	readonly id: string;
}

const maximumWatermarkAdvancesPerTransaction = 512;

export class TypeOrmFullHistoryLedgerCloseMetaManifestRepository implements FullHistoryLedgerCloseMetaManifestRepository {
	constructor(private readonly dataSource: DataSource) {}

	async registerSource(
		registration: FullHistoryLedgerCloseMetaSourceRegistration
	): Promise<FullHistoryLedgerCloseMetaRegisteredSource> {
		validateRegistration(registration);
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			const networkHash = digestBuffer(registration.networkPassphraseHash);
			const configDigest = digestBuffer(registration.configDigest);
			await manager.query(
				`insert into "full_history_ledger_close_meta_source" (
					"id", "network_passphrase_hash", "base_uri",
					"config_object_key", "config_digest", "config_generation",
					"config_version", "compression", "ledgers_per_batch",
					"batches_per_partition", "config_bytes", "config_json",
					"first_available_ledger", "observed_at"
				) values (
					$1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
					$11, $12::jsonb, $13, $14
				) on conflict (
					"network_passphrase_hash", "base_uri", "config_object_key",
					"config_digest"
				) do nothing`,
				[
					randomUUID(),
					networkHash,
					registration.source.sourceUri,
					registration.configObject.identity.objectKey,
					configDigest,
					registration.configObject.identity.generation,
					registration.config.version,
					registration.config.compression,
					registration.config.ledgersPerBatch,
					registration.config.batchesPerPartition,
					registration.configObject.bytes.byteLength,
					JSON.stringify(registration.config),
					registration.firstAvailableLedger,
					registration.observedAt
				]
			);
			const source = exactlyOne(
				await manager.query<SourceRow[]>(
					`select "id", "network_passphrase_hash" as "networkPassphraseHash",
						"config_digest" as "configDigest",
						"first_available_ledger"::text as "firstAvailableLedger"
					 from "full_history_ledger_close_meta_source"
					 where "network_passphrase_hash" = $1
						and "base_uri" = $2 and "config_object_key" = $3
						and "config_digest" = $4`,
					[
						networkHash,
						registration.source.sourceUri,
						registration.configObject.identity.objectKey,
						configDigest
					]
				),
				'source'
			);
			if (
				Number(source.firstAvailableLedger) !==
				registration.firstAvailableLedger
			) {
				throw new Error(
					'Existing LedgerCloseMeta source has a different first ledger'
				);
			}
			await manager.query(
				`insert into "full_history_ledger_close_meta_watermark" (
					"network_passphrase_hash", "first_available_ledger", "next_ledger"
				) values ($1, $2, $2) on conflict do nothing`,
				[networkHash, registration.firstAvailableLedger]
			);
			const watermark = await loadWatermark(manager, networkHash);
			if (
				Number(watermark.firstAvailableLedger) !==
				registration.firstAvailableLedger
			) {
				throw new Error('LedgerCloseMeta source does not match network origin');
			}
			return Object.freeze({
				configDigest: digest(source.configDigest),
				firstAvailableLedger: fullHistoryLedgerCloseMetaSequence(
					Number(source.firstAvailableLedger)
				),
				networkPassphraseHash: digest(source.networkPassphraseHash),
				nextLedger: databaseInteger(watermark.nextLedger, 'nextLedger'),
				sourceId: source.id,
				watermarkVersion: databaseInteger(watermark.version, 'watermarkVersion')
			});
		});
	}

	async commitProcessedBatch(
		batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
	): Promise<FullHistoryLedgerCloseMetaBatchCommitReceipt> {
		validateProcessedBatch(batch);
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			const networkHash = digestBuffer(batch.source.networkPassphraseHash);
			await lockNetwork(manager, batch.source.networkPassphraseHash);
			const existingId = await findAndVerifyFullHistoryLedgerCloseMetaBatch(
				manager,
				batch,
				networkHash
			);
			if (existingId !== null) {
				const advanced = await advanceWatermark(
					manager,
					networkHash,
					await lockWatermark(manager, networkHash)
				);
				return receipt(existingId, advanced, true);
			}
			const watermark = await lockWatermark(manager, networkHash);
			if (batch.processing.range.startSequence < Number(watermark.nextLedger)) {
				throw new Error(
					'LedgerCloseMeta shard begins before durable watermark'
				);
			}
			const batchId = randomUUID();
			await insertFullHistoryLedgerCloseMetaBatch(
				manager,
				batchId,
				batch,
				networkHash
			);
			const advanced = await advanceWatermark(manager, networkHash, watermark);
			return receipt(batchId, advanced, false);
		});
	}

	async readStoredBytes(): Promise<bigint> {
		const rows = await this.dataSource.query<Array<{ readonly bytes: string }>>(
			`select coalesce(sum("output_bytes"), 0)::text as "bytes"
			 from "full_history_ledger_close_meta_dataset"`
		);
		return BigInt(exactlyOne(rows, 'storage usage').bytes);
	}
}

async function advanceWatermark(
	manager: EntityManager,
	networkHash: Buffer,
	initial: WatermarkRow
): Promise<WatermarkRow> {
	let watermark = initial;
	for (
		let advances = 0;
		advances < maximumWatermarkAdvancesPerTransaction;
		advances += 1
	) {
		const rows = await manager.query<ContiguousBatchRow[]>(
			`select "id", "end_ledger"::text as "endLedger"
			 from "full_history_ledger_close_meta_batch"
			 where "network_passphrase_hash" = $1 and "start_ledger" = $2`,
			[networkHash, watermark.nextLedger]
		);
		if (rows.length === 0) return watermark;
		const batch = exactlyOne(rows, 'contiguous batch');
		const nextLedger = databaseInteger(batch.endLedger, 'endLedger') + 1;
		await manager.query(
			`update "full_history_ledger_close_meta_watermark"
			 set "last_batch_id" = $2, "next_ledger" = $3,
				"version" = "version" + 1, "updated_at" = now()
			 where "network_passphrase_hash" = $1 and "version" = $4`,
			[networkHash, batch.id, nextLedger, watermark.version]
		);
		watermark = await loadWatermark(manager, networkHash);
		if (databaseInteger(watermark.nextLedger, 'nextLedger') !== nextLedger) {
			throw new Error('LedgerCloseMeta watermark advance was not persisted');
		}
	}
	return watermark;
}

async function loadWatermark(manager: EntityManager, networkHash: Buffer) {
	return exactlyOne(
		await manager.query<WatermarkRow[]>(
			`select "first_available_ledger"::text as "firstAvailableLedger",
				"next_ledger"::text as "nextLedger", "version"::text
			 from "full_history_ledger_close_meta_watermark"
			 where "network_passphrase_hash" = $1`,
			[networkHash]
		),
		'watermark'
	);
}

async function lockWatermark(manager: EntityManager, networkHash: Buffer) {
	return exactlyOne(
		await manager.query<WatermarkRow[]>(
			`select "first_available_ledger"::text as "firstAvailableLedger",
				"next_ledger"::text as "nextLedger", "version"::text
			 from "full_history_ledger_close_meta_watermark"
			 where "network_passphrase_hash" = $1 for update`,
			[networkHash]
		),
		'locked watermark'
	);
}

function validateProcessedBatch(
	batch: FullHistoryLedgerCloseMetaProcessedBatchCommit
): void {
	assertFullHistoryLedgerCloseMetaProcessingReceipt(batch.processing);
	if (Number.isNaN(batch.processedAt.getTime())) {
		throw new Error('Invalid processedAt');
	}
}

function validateRegistration(
	registration: FullHistoryLedgerCloseMetaSourceRegistration
): void {
	if (sha256(registration.configObject.bytes) !== registration.configDigest) {
		throw new Error('LedgerCloseMeta config digest does not match its bytes');
	}
	if (
		sha256(Buffer.from(registration.config.networkPassphrase, 'utf8')) !==
		registration.networkPassphraseHash
	) {
		throw new Error('LedgerCloseMeta network passphrase hash does not match');
	}
	if (Number.isNaN(registration.observedAt.getTime())) {
		throw new Error('LedgerCloseMeta source observation is invalid');
	}
}

function receipt(batchId: string, watermark: WatermarkRow, replayed: boolean) {
	return Object.freeze({
		batchId,
		nextLedger: databaseInteger(watermark.nextLedger, 'nextLedger'),
		replayed,
		watermarkVersion: databaseInteger(watermark.version, 'watermarkVersion')
	});
}

async function lockNetwork(
	manager: EntityManager,
	networkHash: string
): Promise<void> {
	await manager.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
		networkHash
	]);
}

async function setTransactionBounds(manager: EntityManager): Promise<void> {
	await manager.query(
		`set local lock_timeout = '2s'; set local statement_timeout = '30s'`
	);
}

function digestBuffer(value: FullHistoryLedgerCloseMetaSha256Digest): Buffer {
	return Buffer.from(fullHistoryLedgerCloseMetaSha256Digest(value), 'hex');
}

function digest(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		Buffer.from(value).toString('hex')
	);
}

function sha256(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}

function exactlyOne<T>(rows: readonly T[], label: string): T {
	if (rows.length !== 1)
		throw new Error(`Expected one LedgerCloseMeta ${label}`);
	return rows[0]!;
}

function databaseInteger(value: string, field: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`Invalid database ${field}`);
	}
	return parsed;
}
