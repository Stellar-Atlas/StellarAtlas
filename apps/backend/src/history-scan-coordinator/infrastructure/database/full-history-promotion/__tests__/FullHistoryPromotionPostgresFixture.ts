import { createHash } from 'node:crypto';
import type { DataSource, QueryRunner } from 'typeorm';
import type { FullHistoryPromotionTarget } from '../../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import { FullHistoryHash } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryCanonicalSchemaMigration1784860000000 } from '../../migrations/1784860000000-FullHistoryCanonicalSchemaMigration.js';
import { FullHistoryOperationFactsMigration1784960000000 } from '../../migrations/1784960000000-FullHistoryOperationFactsMigration.js';
import { ParsedLedgerHeaderMigration1784000000000 } from '../../migrations/1784000000000-ParsedLedgerHeaderMigration.js';
import { HistoryArchiveCheckpointProofMigration1784420000000 } from '../../migrations/1784420000000-HistoryArchiveCheckpointProofMigration.js';
import { ParsedTransactionIndexMigration1784600000000 } from '../../migrations/1784600000000-ParsedTransactionIndexMigration.js';
import { ParsedLedgerClosedAtMigration1784840000000 } from '../../migrations/1784840000000-ParsedLedgerClosedAtMigration.js';
import { ParsedHistoryObservationMigration1784850000000 } from '../../migrations/1784850000000-ParsedHistoryObservationMigration.js';
import {
	emptyTransactionResultSetHash,
	type RealTransactionFixture
} from '../../../full-history-promotion/__tests__/RealStellarXdrFixtures.js';

export interface SeededPromotionCandidate {
	readonly archiveUrlIdentity: string;
	readonly exactFirstClosedAt: Date;
	readonly proofId: number;
	readonly sourceIds: {
		readonly checkpointState: string;
		readonly ledger: string;
		readonly results: string;
		readonly transactions: string;
	};
	readonly target: FullHistoryPromotionTarget;
}

interface SeedOptions {
	readonly checkpointLedger?: number;
	readonly networkPassphrase: string;
	readonly seed: number;
	readonly transaction?: RealTransactionFixture;
}

export async function installPromotionSchema(
	dataSource: DataSource
): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	try {
		await new ParsedLedgerHeaderMigration1784000000000().up(runner);
		await new HistoryArchiveCheckpointProofMigration1784420000000().up(runner);
		await new ParsedTransactionIndexMigration1784600000000().up(runner);
		await new ParsedLedgerClosedAtMigration1784840000000().up(runner);
		await new ParsedHistoryObservationMigration1784850000000().up(runner);
		await createSourceObjectTable(runner);
		await new FullHistoryCanonicalSchemaMigration1784860000000().up(runner);
		await new FullHistoryOperationFactsMigration1784960000000().up(runner);
		await runner.commitTransaction();
	} catch (error) {
		await runner.rollbackTransaction();
		throw error;
	} finally {
		await runner.release();
	}
}

export async function seedPromotionCandidate(
	dataSource: DataSource,
	options: SeedOptions
): Promise<SeededPromotionCandidate> {
	const inferredCheckpoint = options.transaction
		? options.transaction.ledgerSequence -
			(options.transaction.ledgerSequence % 64) +
			63
		: 63;
	const checkpointLedger = options.checkpointLedger ?? inferredCheckpoint;
	if (checkpointLedger % 64 !== 63) {
		throw new Error('Promotion fixture checkpoint is not globally aligned');
	}
	const firstLedger = checkpointLedger === 63 ? 1 : checkpointLedger - 63;
	if (
		options.transaction &&
		(options.transaction.ledgerSequence < firstLedger ||
			options.transaction.ledgerSequence > checkpointLedger)
	) {
		throw new Error('Promotion fixture transaction is outside its checkpoint');
	}
	const archiveUrlIdentity = `https://archive-${options.seed}.example/history`;
	const sourceIds = {
		checkpointState: fixtureUuid(options.seed * 10 + 1),
		ledger: fixtureUuid(options.seed * 10 + 2),
		results: fixtureUuid(options.seed * 10 + 4),
		transactions: fixtureUuid(options.seed * 10 + 3)
	};
	const digests = {
		checkpointState: hash(`checkpoint:${options.seed}`),
		ledger: hash(`ledger-source:${options.seed}`),
		results: hash(`results-source:${options.seed}`),
		transactions: hash(`transactions-source:${options.seed}`)
	};
	await insertSourceObjects(
		dataSource,
		archiveUrlIdentity,
		checkpointLedger,
		sourceIds,
		digests
	);
	const proofId = await insertProof(dataSource, {
		archiveUrlIdentity,
		checkpointLedger,
		networkPassphrase: options.networkPassphrase,
		sourceIds
	});
	const exactFirstClosedAt = new Date(
		Date.UTC(2026, 6, 11, 2, options.seed % 60, 0)
	);
	await insertObservedLedgers(dataSource, {
		archiveUrlIdentity,
		checkpointLedger,
		exactFirstClosedAt,
		firstLedger,
		seed: options.seed,
		sourceId: sourceIds.ledger,
		transaction: options.transaction
	});
	if (options.transaction) {
		await insertObservedTransaction(
			dataSource,
			archiveUrlIdentity,
			sourceIds,
			options.transaction
		);
	}
	await insertDecoyObservations(dataSource, options.seed, firstLedger);

	return {
		archiveUrlIdentity,
		exactFirstClosedAt,
		proofId,
		sourceIds,
		target: {
			archiveUrlIdentity,
			checkpointLedger,
			networkPassphrase: options.networkPassphrase
		}
	};
}

async function createSourceObjectTable(runner: QueryRunner): Promise<void> {
	await runner.query(`
		create table "history_archive_object_queue" (
			"id" bigserial not null,
			"remoteId" uuid not null,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"status" text not null,
			"checkpointLedger" integer,
			"verificationFacts" jsonb,
			constraint "PK_history_archive_object_queue_promotion_fixture"
				primary key ("id"),
			constraint "UQ_history_archive_object_queue_promotion_fixture"
				unique ("remoteId")
		)
	`);
}

async function insertSourceObjects(
	dataSource: DataSource,
	archiveUrlIdentity: string,
	checkpointLedger: number,
	sourceIds: SeededPromotionCandidate['sourceIds'],
	digests: Record<keyof SeededPromotionCandidate['sourceIds'], FullHistoryHash>
): Promise<void> {
	const rows = [
		['checkpoint-state', 'canonical-json', 'checkpointState'],
		['ledger', 'uncompressed-xdr', 'ledger'],
		['transactions', 'uncompressed-xdr', 'transactions'],
		['results', 'uncompressed-xdr', 'results']
	] as const;
	for (const [objectType, representation, key] of rows) {
		await dataSource.query(
			`insert into "history_archive_object_queue" (
				"remoteId", "archiveUrlIdentity", "objectType", "status",
				"checkpointLedger", "verificationFacts"
			) values ($1, $2, $3, 'verified', $4, $5::jsonb)`,
			[
				sourceIds[key],
				archiveUrlIdentity,
				objectType,
				checkpointLedger,
				JSON.stringify({
					content: {
						algorithm: 'sha256',
						digest: digests[key].toHex(),
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
		readonly sourceIds: SeededPromotionCandidate['sourceIds'];
	}
): Promise<number> {
	const count = input.checkpointLedger === 63 ? 63 : 64;
	const rows = (await dataSource.query(
		`insert into "history_archive_checkpoint_proof" (
			"archiveUrl", "archiveUrlIdentity", "checkpointLedger", "status",
			"proofVersion", "requiredObjectsComplete", "proofFactsComplete",
			"checkpointBucketListMatches", "transactionsMatch", "resultsMatch",
			"previousLedgersMatch", "bucketsVerified", "ledgerFactCount",
			"transactionFactCount", "resultFactCount", "failureKind", "details",
			"evaluatedAt", "checkpointStateObjectRemoteId", "ledgerObjectRemoteId",
			"transactionsObjectRemoteId", "resultsObjectRemoteId"
		) values (
			$1, $1, $2, 'verified', 5, true, true, true, true, true, true, true,
			$3, $3, $3, null, $4::jsonb, $5, $6, $7, $8, $9
		) returning id`,
		[
			input.archiveUrlIdentity,
			input.checkpointLedger,
			count,
			JSON.stringify({ networkPassphrase: input.networkPassphrase }),
			new Date('2026-07-11T03:00:00.000Z'),
			input.sourceIds.checkpointState,
			input.sourceIds.ledger,
			input.sourceIds.transactions,
			input.sourceIds.results
		]
	)) as Array<{ readonly id: number }>;
	if (rows[0] === undefined)
		throw new Error('Proof fixture insert returned no id');
	return rows[0].id;
}

async function insertObservedLedgers(
	dataSource: DataSource,
	input: {
		readonly archiveUrlIdentity: string;
		readonly checkpointLedger: number;
		readonly exactFirstClosedAt: Date;
		readonly firstLedger: number;
		readonly seed: number;
		readonly sourceId: string;
		readonly transaction?: RealTransactionFixture;
	}
): Promise<void> {
	for (
		let sequence = input.firstLedger;
		sequence <= input.checkpointLedger;
		sequence += 1
	) {
		const transaction =
			input.transaction?.ledgerSequence === sequence
				? input.transaction
				: undefined;
		const closedAt = new Date(
			input.exactFirstClosedAt.getTime() +
				(sequence - input.firstLedger) * 5_000
		);
		const row = (await dataSource.query(
			`insert into "parsed_ledger_header" (
				"ledgerSequence", "ledgerHeaderHash", "previousLedgerHeaderHash",
				"transactionSetHash", "transactionResultHash", "bucketListHash",
				"protocolVersion", "firstSourceArchiveUrl", "lastSourceArchiveUrl",
				"lastScanJobRemoteId", "firstSeenAt", "lastSeenAt", "closedAt"
			) values ($1, $2, $3, $4, $5, $6, 27, $7, $7, $8, now(), now(), $9)
			returning id`,
			[
				sequence,
				base64Hash(`ledger:${input.seed}:${sequence}`),
				base64Hash(`ledger:${input.seed}:${sequence - 1}`),
				(
					transaction?.transactionSetHash ??
					hash(`transactions:${input.seed}:${sequence}`)
				)
					.toBuffer()
					.toString('base64'),
				(transaction?.transactionResultHash ?? emptyTransactionResultSetHash())
					.toBuffer()
					.toString('base64'),
				base64Hash(`bucket:${input.seed}:${sequence}`),
				input.archiveUrlIdentity,
				`scan-${input.seed}`,
				new Date('2040-01-01T00:00:00.000Z')
			]
		)) as Array<{ readonly id: number }>;
		await dataSource.query(
			`insert into "parsed_ledger_header_observation" (
				"parsedLedgerHeaderId", "sourceObjectRemoteId", "observedAt", "closedAt"
			) values ($1, $2, now(), $3)`,
			[row[0]!.id, input.sourceId, closedAt]
		);
	}
}

async function insertObservedTransaction(
	dataSource: DataSource,
	archiveUrlIdentity: string,
	sourceIds: SeededPromotionCandidate['sourceIds'],
	transaction: RealTransactionFixture
): Promise<void> {
	const envelope = (await dataSource.query(
		`with inserted as (
			insert into "parsed_transaction_envelope" (
				"ledgerSequence", "transactionIndex", "transactionSetHash", "envelopeXdr",
				"firstSourceArchiveUrl", "lastSourceArchiveUrl", "lastScanJobRemoteId",
				"firstSeenAt", "lastSeenAt"
			) values ($1, 0, $2, $3, $4, $4, 'scan-real', now(), now())
			on conflict ("ledgerSequence", "transactionSetHash", "transactionIndex")
			do nothing returning id
		)
		select id from inserted
		union all
		select id from "parsed_transaction_envelope"
		where "ledgerSequence" = $1 and "transactionIndex" = 0
			and "transactionSetHash" = $2 and "envelopeXdr" = $3
		limit 1`,
		[
			transaction.ledgerSequence,
			transaction.transactionSetHash.toBuffer().toString('base64'),
			transaction.envelopeXdr,
			archiveUrlIdentity
		]
	)) as Array<{ readonly id: number }>;
	const result = (await dataSource.query(
		`with inserted as (
			insert into "parsed_transaction_result" (
				"ledgerSequence", "transactionIndex", "transactionResultHash",
				"transactionHash", "resultXdr", "firstSourceArchiveUrl",
				"lastSourceArchiveUrl", "lastScanJobRemoteId", "firstSeenAt", "lastSeenAt"
			) values ($1, 0, $2, $3, $4, $5, $5, 'scan-real', now(), now())
			on conflict ("ledgerSequence", "transactionResultHash", "transactionIndex")
			do nothing returning id
		)
		select id from inserted
		union all
		select id from "parsed_transaction_result"
		where "ledgerSequence" = $1 and "transactionIndex" = 0
			and "transactionResultHash" = $2 and "transactionHash" = $3
			and "resultXdr" = $4
		limit 1`,
		[
			transaction.ledgerSequence,
			transaction.transactionResultHash.toBuffer().toString('base64'),
			transaction.transactionHash.toBuffer().toString('base64'),
			transaction.resultXdr,
			archiveUrlIdentity
		]
	)) as Array<{ readonly id: number }>;
	await dataSource.query(
		`insert into "parsed_transaction_envelope_observation" (
			"parsedTransactionEnvelopeId", "sourceObjectRemoteId", "observedAt"
		) values ($1, $2, now())`,
		[envelope[0]!.id, sourceIds.transactions]
	);
	await dataSource.query(
		`insert into "parsed_transaction_result_observation" (
			"parsedTransactionResultId", "sourceObjectRemoteId", "observedAt"
		) values ($1, $2, now())`,
		[result[0]!.id, sourceIds.results]
	);
}

async function insertDecoyObservations(
	dataSource: DataSource,
	seed: number,
	ledgerSequence: number
): Promise<void> {
	const row = (await dataSource.query(
		`insert into "parsed_ledger_header" (
			"ledgerSequence", "ledgerHeaderHash", "previousLedgerHeaderHash",
			"transactionSetHash", "transactionResultHash", "bucketListHash",
			"protocolVersion", "firstSourceArchiveUrl", "lastSourceArchiveUrl",
			"lastScanJobRemoteId", "firstSeenAt", "lastSeenAt"
		) values ($1, $2, $3, $4, $5, $6, 27, 'decoy', 'decoy', 'decoy', now(), now())
		returning id`,
		[
			ledgerSequence,
			base64Hash(`decoy-ledger:${seed}`),
			base64Hash(`decoy-previous:${seed}`),
			base64Hash(`decoy-transactions:${seed}`),
			base64Hash(`decoy-results:${seed}`),
			base64Hash(`decoy-bucket:${seed}`)
		]
	)) as Array<{ readonly id: number }>;
	await dataSource.query(
		`insert into "parsed_ledger_header_observation" (
			"parsedLedgerHeaderId", "sourceObjectRemoteId", "observedAt", "closedAt"
		) values ($1, $2, now(), '1999-01-01T00:00:00Z')`,
		[row[0]!.id, fixtureUuid(seed * 10 + 9)]
	);
}

function hash(value: string): FullHistoryHash {
	return FullHistoryHash.fromBytes(createHash('sha256').update(value).digest());
}

function base64Hash(value: string): string {
	return hash(value).toBuffer().toString('base64');
}

function fixtureUuid(seed: number): string {
	return `00000000-0000-4000-8000-${seed.toString(16).padStart(12, '0')}`;
}
