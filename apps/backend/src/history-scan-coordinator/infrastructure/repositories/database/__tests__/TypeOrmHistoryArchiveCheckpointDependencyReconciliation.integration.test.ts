import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	HistoryArchiveCheckpointProof
} from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObjectHostThrottleMigration1784410000000 } from '../../../database/migrations/1784410000000-HistoryArchiveObjectHostThrottleMigration.js';
import { HistoryArchiveObjectClaimCursorMigration1784780000000 } from '../../../database/migrations/1784780000000-HistoryArchiveObjectClaimCursorMigration.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { checkpointObject } from './HistoryArchiveObjectRepositoryFixture.js';
import { createCanonicalFrontierTestSchema } from './HistoryArchiveCanonicalFrontierTestSchema.js';

jest.setTimeout(60_000);

describe('checkpoint dependency reconciliation in PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [HistoryArchiveCheckpointProof, HistoryArchiveObject],
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const queryRunner = dataSource.createQueryRunner();
		await new HistoryArchiveObjectHostThrottleMigration1784410000000().up(
			queryRunner
		);
		await new HistoryArchiveObjectClaimCursorMigration1784780000000().up(
			queryRunner
		);
		await queryRunner.release();
		await createCanonicalFrontierTestSchema(dataSource);
		repository = new TypeOrmHistoryArchiveObjectRepository(
			dataSource.getRepository(HistoryArchiveObject)
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate history_archive_checkpoint_proof, history_archive_object_queue, history_archive_checkpoint_bucket_dependency, history_archive_state_snapshot, full_history_historical_backfill_job, full_history_watermark, full_history_promotion_runtime restart identity cascade'
		);
	});

	it('prioritizes the active canonical runtime checkpoint', async () => {
		const passphrase = 'Active canonical reconciliation fixture';
		const ordinary = checkpointObject(
			'https://ordinary.example',
			63,
			'verified'
		);
		const active = checkpointObject('https://active.example', 127, 'verified');
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([ordinary, active]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(mismatchProof(ordinary));
		await dataSource.query(
			`insert into history_archive_state_snapshot (
				"archiveUrlIdentity", status, "networkPassphrase"
			) values ($1, 'available', $2)`,
			[active.archiveUrlIdentity, passphrase]
		);
		await dataSource.query(
			`insert into full_history_promotion_runtime (
				"network_passphrase_hash", state, "checkpoint_ledger"
			) values ($1, 'waiting-for-proof', $2)`,
			[createHash('sha256').update(passphrase, 'utf8').digest(), 127]
		);

		const result =
			await repository.findVerifiedCheckpointsNeedingReconciliation(1);

		expect(result.map((object) => object.remoteId)).toEqual([active.remoteId]);
	});

	it('prioritizes stale mismatch proofs before the unmaterialized backlog', async () => {
		const missing = checkpointObject('https://missing.example', 63, 'verified');
		const done = checkpointObject('https://done.example', 127, 'verified');
		done.dependenciesMaterializedAt = new Date();
		const pending = checkpointObject('https://pending.example', 191, 'pending');
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([missing, done, pending]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(mismatchProof(done));

		const result =
			await repository.findVerifiedCheckpointsNeedingReconciliation(1);

		expect(result.map((object) => object.remoteId)).toEqual([done.remoteId]);
	});

	it('prioritizes proof-ready checkpoints waiting only for buckets', async () => {
		const ordinary = checkpointObject(
			'https://ordinary.example',
			255,
			'verified'
		);
		const bucketReady = checkpointObject(
			'https://bucket-ready.example',
			319,
			'verified'
		);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([ordinary, bucketReady]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(bucketMissingProof(bucketReady));

		const result =
			await repository.findVerifiedCheckpointsNeedingReconciliation(1);

		expect(result.map((object) => object.remoteId)).toEqual([
			bucketReady.remoteId
		]);
	});

	it('prioritizes a canonical proof after its final bucket evidence changes', async () => {
		const fixture = await saveCanonicalPendingProofFixture(
			dataSource,
			new Date('2026-07-18T00:00:00.000Z')
		);

		const result =
			await repository.findVerifiedCheckpointsNeedingReconciliation(1);

		expect(result.map((object) => object.remoteId)).toEqual([
			fixture.checkpoint.remoteId
		]);
	});

	it('does not reevaluate an unchanged current-version canonical proof', async () => {
		await saveCanonicalPendingProofFixture(
			dataSource,
			new Date('2026-07-20T00:00:00.000Z')
		);

		await expect(
			repository.findVerifiedCheckpointsNeedingReconciliation(1)
		).resolves.toEqual([]);
	});
});

async function saveCanonicalPendingProofFixture(
	dataSource: DataSource,
	proofEvaluatedAt: Date
): Promise<{ readonly checkpoint: HistoryArchiveObject }> {
	const archiveUrl = 'https://canonical.example';
	const checkpointLedger = 127;
	const passphrase = 'Canonical stale proof fixture';
	const bucketHash = 'a'.repeat(64);
	const checkpoint = checkpointObject(archiveUrl, checkpointLedger, 'verified');
	checkpoint.dependenciesMaterializedAt = new Date('2026-07-17T00:00:00.000Z');
	const required = [
		checkpoint,
		proofObject(archiveUrl, checkpointLedger, 'ledger'),
		proofObject(archiveUrl, checkpointLedger, 'transactions'),
		proofObject(archiveUrl, checkpointLedger, 'results'),
		proofObject(archiveUrl, checkpointLedger - 64, 'ledger')
	];
	const bucket = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket-${bucketHash}.xdr.gz`,
		status: 'verified'
	});
	bucket.verificationFacts = {
		bucketObject: {
			expectedBucketHash: bucketHash,
			hashAlgorithm: 'sha256',
			matched: true,
			sourceUrl: bucket.objectUrl
		}
	};
	await dataSource
		.getRepository(HistoryArchiveObject)
		.save([...required, bucket]);
	await dataSource.query(
		`update history_archive_object_queue
		 set "verifiedAt" = $1, "updatedAt" = $1`,
		[new Date('2026-07-17T00:00:00.000Z')]
	);
	await dataSource.query(
		`update history_archive_object_queue
		 set "verifiedAt" = $1, "updatedAt" = $1
		 where "remoteId" = $2`,
		[new Date('2026-07-19T00:00:00.000Z'), bucket.remoteId]
	);
	await dataSource.query(
		`insert into history_archive_checkpoint_bucket_dependency (
			"archiveUrlIdentity", "checkpointLedger", "bucketHash", "createdAt"
		) values ($1, $2, $3, $4)`,
		[
			archiveUrl,
			checkpointLedger,
			bucketHash,
			new Date('2026-07-17T00:00:00.000Z')
		]
	);
	await dataSource
		.getRepository(HistoryArchiveCheckpointProof)
		.save(pendingProof(checkpoint, proofEvaluatedAt));
	await dataSource.query(
		`insert into history_archive_state_snapshot (
			"archiveUrlIdentity", status, "networkPassphrase"
		) values ($1, 'available', $2)`,
		[archiveUrl, passphrase]
	);
	await dataSource.query(
		`insert into full_history_promotion_runtime (
			"network_passphrase_hash", state, "checkpoint_ledger"
		) values ($1, 'waiting-for-proof', $2)`,
		[createHash('sha256').update(passphrase, 'utf8').digest(), checkpointLedger]
	);
	return { checkpoint };
}

function proofObject(
	archiveUrl: string,
	checkpointLedger: number,
	objectType: 'ledger' | 'results' | 'transactions'
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger,
		objectKey: `${objectType}:${checkpointLedger}`,
		objectOrder: 20,
		objectType,
		objectUrl: `${archiveUrl}/${objectType}/${checkpointLedger}.xdr.gz`,
		status: 'verified'
	});
}

function mismatchProof(
	object: HistoryArchiveObject
): HistoryArchiveCheckpointProof {
	const proof = new HistoryArchiveCheckpointProof();
	proof.archiveUrl = object.archiveUrl;
	proof.archiveUrlIdentity = object.archiveUrlIdentity;
	proof.checkpointLedger = object.checkpointLedger ?? 0;
	proof.status = 'mismatch';
	proof.proofVersion = 5;
	proof.requiredObjectsComplete = true;
	proof.proofFactsComplete = true;
	proof.checkpointBucketListMatches = true;
	proof.transactionsMatch = true;
	proof.resultsMatch = true;
	proof.previousLedgersMatch = false;
	proof.bucketsVerified = false;
	proof.ledgerFactCount = 64;
	proof.transactionFactCount = 64;
	proof.resultFactCount = 64;
	proof.expectedBucketCount = 1;
	proof.verifiedBucketCount = 0;
	proof.failedBucketCount = 0;
	proof.missingBucketCount = 1;
	proof.checkpointBucketListHash = null;
	proof.ledgerBucketListHash = null;
	proof.checkpointStateObjectRemoteId = object.remoteId;
	proof.ledgerObjectRemoteId = null;
	proof.transactionsObjectRemoteId = null;
	proof.resultsObjectRemoteId = null;
	proof.scpObjectRemoteId = null;
	proof.failureKind = 'previous-ledger-hash-mismatch';
	proof.details = null;
	proof.evaluatedAt = new Date(0);
	return proof;
}

function bucketMissingProof(
	object: HistoryArchiveObject
): HistoryArchiveCheckpointProof {
	const proof = mismatchProof(object);
	proof.status = 'not-evaluable';
	proof.previousLedgersMatch = true;
	proof.failureKind = 'bucket-missing';
	return proof;
}

function pendingProof(
	object: HistoryArchiveObject,
	evaluatedAt: Date
): HistoryArchiveCheckpointProof {
	const proof = bucketMissingProof(object);
	proof.status = 'pending';
	proof.proofVersion = CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION;
	proof.evaluatedAt = evaluatedAt;
	return proof;
}
