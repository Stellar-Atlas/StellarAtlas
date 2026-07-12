import { createHash } from 'node:crypto';
import { StrKey } from '@stellar/stellar-sdk';
import type { DataSource, QueryRunner } from 'typeorm';
import type {
	FullHistoryCheckpointWrite,
	FullHistoryEnvelopeType
} from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '../../migrations/1784860000000-FullHistoryCanonicalSchemaMigration.js';
import { HistoryArchiveCheckpointProofMigration1784420000000 } from '../../migrations/1784420000000-HistoryArchiveCheckpointProofMigration.js';
import { FullHistoryIngestionBatch } from '../entities/FullHistoryIngestionBatch.js';
import { FullHistoryLedger } from '../entities/FullHistoryLedger.js';
import { FullHistoryTransaction } from '../entities/FullHistoryTransaction.js';
import { FullHistoryTransactionResult } from '../entities/FullHistoryTransactionResult.js';
import { FullHistoryWatermark } from '../entities/FullHistoryWatermark.js';

export const fullHistoryEntities = [
	FullHistoryIngestionBatch,
	FullHistoryLedger,
	FullHistoryTransaction,
	FullHistoryTransactionResult,
	FullHistoryWatermark
];

interface CheckpointFixtureOptions {
	readonly batchNumber: number;
	readonly checkpointLedger?: number;
	readonly decoderVersion?: string;
	readonly envelopeType?: FullHistoryEnvelopeType;
	readonly feeBid?: string;
	readonly networkPassphrase?: string;
	readonly proofStatus?: 'pending' | 'verified';
	readonly transactionHash?: FullHistoryHash;
}

export async function installFullHistoryPrerequisites(
	queryRunner: QueryRunner
): Promise<void> {
	await new HistoryArchiveCheckpointProofMigration1784420000000().up(
		queryRunner
	);
	await queryRunner.query(`
		create table "history_archive_object_queue" (
			"id" serial not null,
			"remoteId" uuid not null,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"status" text not null,
			"checkpointLedger" integer,
			"verificationFacts" jsonb,
			constraint "PK_history_archive_object_queue_fixture" primary key ("id"),
			constraint "UQ_history_archive_object_queue_remote_fixture"
				unique ("remoteId")
		)
	`);
}

export async function installFullHistoryCanonicalSchema(
	dataSource: DataSource
): Promise<void> {
	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();
	await queryRunner.startTransaction();
	try {
		await installFullHistoryPrerequisites(queryRunner);
		await new FullHistoryCanonicalSchemaMigration1784860000000().up(
			queryRunner
		);
		await queryRunner.commitTransaction();
	} catch (error) {
		await queryRunner.rollbackTransaction();
		throw error;
	} finally {
		await queryRunner.release();
	}
}

export async function seedFullHistoryCheckpoint(
	dataSource: DataSource,
	options: CheckpointFixtureOptions
): Promise<FullHistoryCheckpointWrite> {
	const checkpointLedger = options.checkpointLedger ?? 63;
	if (checkpointLedger % 64 !== 63) {
		throw new Error(
			'Fixture checkpoint must end on a Stellar checkpoint ledger'
		);
	}
	const firstLedger = checkpointLedger === 63 ? 1 : checkpointLedger - 63;
	const ledgerCount = checkpointLedger - firstLedger + 1;
	const networkPassphrase =
		options.networkPassphrase ??
		`Canonical fixture network ${options.batchNumber}`;
	const archiveUrlIdentity = `archive-${options.batchNumber}.example`;
	const proofEvaluatedAt = new Date(
		Date.UTC(2026, 6, 11, 10, options.batchNumber % 60, 0)
	);
	const sources = createSources(options.batchNumber);
	await insertSources(
		dataSource,
		archiveUrlIdentity,
		checkpointLedger,
		sources
	);
	const proofId = await insertProof(dataSource, {
		archiveUrlIdentity,
		checkpointLedger,
		networkPassphrase,
		proofEvaluatedAt,
		proofStatus: options.proofStatus ?? 'verified',
		sources
	});

	const ledgers = Array.from({ length: ledgerCount }, (_, index) => {
		const sequence = firstLedger + index;
		const ledgerHash = fixtureHash(`ledger:${networkPassphrase}:${sequence}`);
		return {
			bucketListHash: fixtureHash(`buckets:${networkPassphrase}:${sequence}`),
			closedAt: new Date(Date.UTC(2026, 6, 11, 12, 0, index)),
			ledgerHash,
			ledgerSequence: fullHistoryLedgerSequence(BigInt(sequence)),
			previousLedgerHash:
				index === 0
					? fixtureHash(`previous:${networkPassphrase}:${sequence}`)
					: fixtureHash(`ledger:${networkPassphrase}:${sequence - 1}`),
			protocolVersion: 27,
			transactionCount: index === 0 ? 1 : 0,
			transactionResultHash: fixtureHash(
				`results:${networkPassphrase}:${sequence}`
			),
			transactionSetHash: fixtureHash(
				`transactions:${networkPassphrase}:${sequence}`
			)
		};
	});
	const transactionHash =
		options.transactionHash ??
		fixtureHash(`transaction:${options.batchNumber}`);
	const sourceAccount = StrKey.encodeEd25519PublicKey(
		Buffer.alloc(32, (options.batchNumber % 254) + 1)
	);

	return {
		archiveUrlIdentity,
		batchId: fixtureUuid(options.batchNumber * 10 + 1),
		checkpointLedger: fullHistoryLedgerSequence(BigInt(checkpointLedger)),
		decoderVersion: options.decoderVersion ?? 'fixture-decoder/1',
		firstLedger: fullHistoryLedgerSequence(BigInt(firstLedger)),
		lastLedger: fullHistoryLedgerSequence(BigInt(checkpointLedger)),
		ledgers,
		networkPassphrase,
		proofEvaluatedAt,
		proofId,
		proofVersion: 5,
		results: [
			{
				feeCharged: fullHistoryUint64('100'),
				ledgerSequence: fullHistoryLedgerSequence(BigInt(firstLedger)),
				operationResultCount: 1,
				resultCode: 0,
				successful: true,
				transactionHash,
				transactionIndex: 0
			}
		],
		sources,
		transactions: [
			{
				envelopeType: options.envelopeType ?? 'tx',
				feeBid: fullHistoryUint64(options.feeBid ?? '200'),
				ledgerSequence: fullHistoryLedgerSequence(BigInt(firstLedger)),
				operationCount: 1,
				sourceAccount,
				sourceAccountSequence: fullHistoryUint64('9223372036854775807'),
				transactionHash,
				transactionIndex: 0
			}
		]
	};
}

export function fixtureHash(label: string): FullHistoryHash {
	return FullHistoryHash.fromBytes(createHash('sha256').update(label).digest());
}

function createSources(seed: number): FullHistoryCheckpointWrite['sources'] {
	return {
		checkpointState: {
			contentDigest: fixtureHash(`checkpoint-digest:${seed}`),
			remoteId: fixtureUuid(seed * 10 + 2)
		},
		ledger: {
			contentDigest: fixtureHash(`ledger-digest:${seed}`),
			remoteId: fixtureUuid(seed * 10 + 3)
		},
		results: {
			contentDigest: fixtureHash(`results-digest:${seed}`),
			remoteId: fixtureUuid(seed * 10 + 5)
		},
		transactions: {
			contentDigest: fixtureHash(`transactions-digest:${seed}`),
			remoteId: fixtureUuid(seed * 10 + 4)
		}
	};
}

async function insertSources(
	dataSource: DataSource,
	archiveUrlIdentity: string,
	checkpointLedger: number,
	sources: FullHistoryCheckpointWrite['sources']
): Promise<void> {
	const rows = [
		['checkpoint-state', 'canonical-json', sources.checkpointState],
		['ledger', 'uncompressed-xdr', sources.ledger],
		['transactions', 'uncompressed-xdr', sources.transactions],
		['results', 'uncompressed-xdr', sources.results]
	] as const;
	for (const [objectType, representation, source] of rows) {
		await dataSource.query(
			`
				insert into "history_archive_object_queue" (
					"remoteId", "archiveUrlIdentity", "objectType", "status",
					"checkpointLedger", "verificationFacts"
				) values ($1, $2, $3, 'verified', $4, $5::jsonb)
			`,
			[
				source.remoteId,
				archiveUrlIdentity,
				objectType,
				checkpointLedger,
				JSON.stringify({
					content: {
						algorithm: 'sha256',
						digest: source.contentDigest.toHex(),
						representation
					}
				})
			]
		);
	}
}

async function insertProof(
	dataSource: DataSource,
	input: {
		readonly archiveUrlIdentity: string;
		readonly checkpointLedger: number;
		readonly networkPassphrase: string;
		readonly proofEvaluatedAt: Date;
		readonly proofStatus: 'pending' | 'verified';
		readonly sources: FullHistoryCheckpointWrite['sources'];
	}
): Promise<number> {
	const strict = input.proofStatus === 'verified';
	const ledgerFactCount = input.checkpointLedger === 63 ? 63 : 64;
	const rows = (await dataSource.query(
		`
			insert into "history_archive_checkpoint_proof" (
				"archiveUrl", "archiveUrlIdentity", "checkpointLedger", "status",
				"proofVersion", "requiredObjectsComplete", "proofFactsComplete",
				"checkpointBucketListMatches", "transactionsMatch", "resultsMatch",
				"previousLedgersMatch", "bucketsVerified", "ledgerFactCount",
				"transactionFactCount", "resultFactCount", "expectedBucketCount",
				"verifiedBucketCount", "failedBucketCount", "missingBucketCount",
				"checkpointBucketListHash", "ledgerBucketListHash",
				"checkpointStateObjectRemoteId", "ledgerObjectRemoteId",
				"transactionsObjectRemoteId", "resultsObjectRemoteId",
				"scpObjectRemoteId", "failureKind", "details", "evaluatedAt"
			) values (
				$1, $2, $3, $4, 5, $5, $5, $5, $5, $5, $5, $5,
				$15, $15, $15, 1, $6, 0, $7, $8, $8, $9, $10, $11, $12,
				null, null, $13::jsonb, $14
			) returning id
		`,
		[
			`https://${input.archiveUrlIdentity}`,
			input.archiveUrlIdentity,
			input.checkpointLedger,
			input.proofStatus,
			strict,
			strict ? 1 : 0,
			strict ? 0 : 1,
			fixtureHash(`bucket-list:${input.archiveUrlIdentity}`).toHex(),
			input.sources.checkpointState.remoteId,
			input.sources.ledger.remoteId,
			input.sources.transactions.remoteId,
			input.sources.results.remoteId,
			JSON.stringify({ networkPassphrase: input.networkPassphrase }),
			input.proofEvaluatedAt,
			ledgerFactCount
		]
	)) as Array<{ readonly id: number }>;
	const id = rows[0]?.id;
	if (id === undefined) throw new Error('Failed to seed checkpoint proof');
	return id;
}

function fixtureUuid(value: number): string {
	return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}
