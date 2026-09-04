import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	HistoryArchiveCheckpointProof
} from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveStateSnapshot } from '../../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { findVerifiedBucketSources } from '../HistoryArchiveVerifiedBucketSourceQuery.js';

jest.setTimeout(60_000);

const networkPassphrase = 'Public Global Stellar Network ; September 2015';
const testnetPassphrase = 'Test SDF Network ; September 2015';
const targetRoot = 'https://target.example.com/archive';
const validRoot = 'https://valid.example.com/archive';
const staleRoot = 'https://stale.example.com/archive';
const crossNetworkRoot = 'https://testnet.example.com/archive';
const bucketHash = 'a'.repeat(64);
const checkpointLedger = 63;
const publicResolver = async (): Promise<readonly string[]> => ['8.8.8.8'];

describe('verified bucket replacement source query', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [
				HistoryArchiveCheckpointProof,
				HistoryArchiveObject,
				HistoryArchiveStateSnapshot
			],
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await dataSource.query(`
			create table history_archive_checkpoint_bucket_dependency (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"bucketHash" text not null,
				"createdAt" timestamptz not null default now(),
				primary key ("archiveUrlIdentity", "checkpointLedger", "bucketHash")
			)
		`);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate history_archive_checkpoint_bucket_dependency, history_archive_checkpoint_proof, history_archive_object_queue, history_archive_state_snapshot restart identity cascade'
		);
	});

	it('returns only a current same-network source included in a strict proof', async () => {
		const target = bucketObject(targetRoot, 'failed');
		target.failureChannel = 'archive_evidence';
		target.errorType = 'bucket_verification_failed';
		const valid = verifiedBucket(validRoot);
		const stale = verifiedBucket(staleRoot);
		const crossNetwork = verifiedBucket(crossNetworkRoot);
		const validInputs = proofInputs(validRoot);
		const staleInputs = proofInputs(staleRoot);
		const crossNetworkInputs = proofInputs(crossNetworkRoot);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				target,
				valid,
				stale,
				crossNetwork,
				...Object.values(validInputs),
				...Object.values(staleInputs),
				...Object.values(crossNetworkInputs)
			]);
		await dataSource
			.getRepository(HistoryArchiveStateSnapshot)
			.save([
				state(targetRoot, networkPassphrase),
				state(validRoot, networkPassphrase),
				state(staleRoot, networkPassphrase),
				state(crossNetworkRoot, testnetPassphrase)
			]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save([
				proof(validRoot, new Date('2099-07-16T00:01:00.000Z'), validInputs),
				proof(staleRoot, new Date('2026-07-15T23:59:00.000Z'), staleInputs),
				proof(
					crossNetworkRoot,
					new Date('2099-07-16T00:01:00.000Z'),
					crossNetworkInputs
				)
			]);
		for (const archiveUrlIdentity of [validRoot, staleRoot, crossNetworkRoot]) {
			await dataSource.query(
				`insert into history_archive_checkpoint_bucket_dependency
					("archiveUrlIdentity", "checkpointLedger", "bucketHash")
				 values ($1, $2, $3)`,
				[archiveUrlIdentity, checkpointLedger, bucketHash]
			);
		}

		const result = await findVerifiedBucketSources(
			dataSource.manager,
			[target.remoteId],
			5,
			publicResolver
		);

		expect(result).toEqual([
			expect.objectContaining({
				archiveUrlIdentity: validRoot,
				bucketHash,
				candidateRemoteId: valid.remoteId,
				checkpointLedger,
				contentDigest: bucketHash,
				proofEvaluatedAt: new Date('2099-07-16T00:01:00.000Z'),
				proofVersion: CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
				targetRemoteId: target.remoteId
			})
		]);
	});
});

function bucketObject(
	archiveUrl: string,
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash,
		objectKey: `bucket:${bucketHash}`,
		objectOrder: 60,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket/aa/aa/aa/bucket-${bucketHash}.xdr.gz`,
		status
	});
}

type ProofInputs = {
	readonly checkpointState: HistoryArchiveObject;
	readonly ledger: HistoryArchiveObject;
	readonly results: HistoryArchiveObject;
	readonly transactions: HistoryArchiveObject;
};

function proofInputs(archiveUrl: string): ProofInputs {
	const create = (
		objectType: HistoryArchiveObject['objectType']
	): HistoryArchiveObject => {
		const object = new HistoryArchiveObject({
			archiveUrl,
			archiveUrlIdentity: archiveUrl,
			checkpointLedger,
			objectKey: `${objectType}:0000003f`,
			objectOrder: 20,
			objectType,
			objectUrl: `${archiveUrl}/${objectType}/0000003f`,
			status: 'verified'
		});
		object.verifiedAt = new Date('2026-07-16T00:00:00.000Z');
		return object;
	};
	return {
		checkpointState: create('checkpoint-state'),
		ledger: create('ledger'),
		results: create('results'),
		transactions: create('transactions')
	};
}

function verifiedBucket(archiveUrl: string): HistoryArchiveObject {
	const candidate = bucketObject(archiveUrl, 'verified');
	candidate.verifiedAt = new Date('2026-07-16T00:00:00.000Z');
	candidate.verificationFacts = {
		bucketObject: {
			expectedBucketHash: bucketHash,
			hashAlgorithm: 'sha256',
			matched: true,
			sourceUrl: candidate.objectUrl
		},
		content: {
			algorithm: 'sha256',
			digest: bucketHash,
			representation: 'uncompressed-xdr'
		}
	};
	return candidate;
}

function state(
	archiveUrl: string,
	passphrase: string
): HistoryArchiveStateSnapshot {
	return new HistoryArchiveStateSnapshot({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		currentBuckets: [],
		currentLedger: 127,
		errorMessage: null,
		errorType: null,
		hotArchiveBuckets: [],
		httpStatus: null,
		latestFailureHttpStatus: null,
		latestFailureMessage: null,
		latestFailureObservedAt: null,
		latestFailureSource: null,
		latestFailureType: null,
		networkPassphrase: passphrase,
		observedAt: new Date('2026-07-16T00:00:00.000Z'),
		rawState: null,
		server: 'stellar-core',
		source: 'history-scanner',
		stateUrl: `${archiveUrl}/.well-known/stellar-history.json`,
		status: 'available',
		version: 1
	});
}

function proof(
	archiveUrl: string,
	evaluatedAt: Date,
	inputs: ProofInputs
): HistoryArchiveCheckpointProof {
	return Object.assign(new HistoryArchiveCheckpointProof(), {
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketsVerified: true,
		checkpointBucketListHash: bucketHash,
		checkpointBucketListMatches: true,
		checkpointLedger,
		checkpointStateObjectRemoteId: inputs.checkpointState.remoteId,
		evaluatedAt,
		expectedBucketCount: 1,
		failedBucketCount: 0,
		failureKind: null,
		ledgerBucketListHash: bucketHash,
		ledgerFactCount: 64,
		ledgerObjectRemoteId: inputs.ledger.remoteId,
		missingBucketCount: 0,
		previousLedgersMatch: true,
		proofFactsComplete: true,
		proofVersion: CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
		requiredObjectsComplete: true,
		resultFactCount: 64,
		resultsMatch: true,
		resultsObjectRemoteId: inputs.results.remoteId,
		scpObjectRemoteId: null,
		status: 'verified',
		transactionFactCount: 64,
		transactionsMatch: true,
		transactionsObjectRemoteId: inputs.transactions.remoteId,
		verifiedBucketCount: 1
	} satisfies Partial<HistoryArchiveCheckpointProof>);
}
