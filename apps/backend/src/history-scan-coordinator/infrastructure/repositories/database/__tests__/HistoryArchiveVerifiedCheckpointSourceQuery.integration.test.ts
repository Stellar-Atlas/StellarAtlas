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
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { HistoryArchiveStateSnapshot } from '../../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { findVerifiedCheckpointObjectSources } from '../HistoryArchiveVerifiedCheckpointSourceQuery.js';

jest.setTimeout(60_000);

const networkPassphrase = 'Public Global Stellar Network ; September 2015';
const testnetPassphrase = 'Test SDF Network ; September 2015';
const targetRoot = 'https://target.example.com';
const validRoot = 'https://valid.example.com';
const corroboratingRoot = 'https://corroborating.example.com';
const unboundRoot = 'https://unbound.example.com';
const crossNetworkRoot = 'https://testnet.example.com';
const matchingRoot = 'https://matching.example.com';
const mismatchingRoot = 'https://mismatching.example.com';
const checkpointLedger = 63;
const objectKey = 'transactions:0000003f';
const publicResolver = async (): Promise<readonly string[]> => ['8.8.8.8'];

describe('verified checkpoint replacement source query', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [
				HistoryArchiveCheckpointProof,
				HistoryArchiveObject,
				HistoryArchiveObjectEvent,
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
			'truncate history_archive_checkpoint_bucket_dependency, history_archive_object_event, history_archive_checkpoint_proof, history_archive_object_queue, history_archive_state_snapshot restart identity cascade'
		);
	});

	it('returns only the same-network object bound to a current verified proof', async () => {
		const source = object(targetRoot, 'failed');
		source.failureChannel = 'archive_evidence';
		source.errorType = 'archive_http_error';
		source.httpStatus = 404;
		const valid = verifiedObject(validRoot, '1'.repeat(64));
		const corroborating = verifiedObject(corroboratingRoot, '1'.repeat(64));
		const unbound = verifiedObject(unboundRoot, '2'.repeat(64));
		const crossNetwork = verifiedObject(crossNetworkRoot, '3'.repeat(64));
		const validInputs = proofInputs(validRoot, valid);
		const corroboratingInputs = proofInputs(corroboratingRoot, corroborating);
		const unboundInputs = proofInputs(unboundRoot, unbound);
		const crossNetworkInputs = proofInputs(crossNetworkRoot, crossNetwork);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				source,
				...Object.values(validInputs),
				...Object.values(corroboratingInputs),
				...Object.values(unboundInputs),
				...Object.values(crossNetworkInputs)
			]);
		await dataSource
			.getRepository(HistoryArchiveStateSnapshot)
			.save([
				state(targetRoot, networkPassphrase),
				state(validRoot, networkPassphrase),
				state(corroboratingRoot, networkPassphrase),
				state(unboundRoot, networkPassphrase),
				state(crossNetworkRoot, testnetPassphrase)
			]);
		await dataSource.getRepository(HistoryArchiveCheckpointProof).save([
			proof(validRoot, validInputs),
			proof(corroboratingRoot, corroboratingInputs),
			proof(unboundRoot, {
				...unboundInputs,
				transactions: verifiedObject(unboundRoot, '2'.repeat(64))
			}),
			proof(crossNetworkRoot, crossNetworkInputs)
		]);

		const result = await findVerifiedCheckpointObjectSources(
			dataSource.manager,
			[source.remoteId],
			5,
			publicResolver
		);

		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					anchorKind: 'multi-source',
					archiveUrlIdentity: validRoot,
					candidateRemoteId: valid.remoteId,
					checkpointLedger,
					contentDigest: '1'.repeat(64),
					contentRepresentation: 'uncompressed-xdr',
					objectUrl: valid.objectUrl,
					corroboratingSourceCount: 2,
					proofEvaluatedAt: new Date('2099-07-16T00:01:00.000Z'),
					proofVersion: CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
					targetRemoteId: source.remoteId
				})
			])
		);
	});

	it('requires identical content when the failed source has prior verified evidence', async () => {
		const source = object(targetRoot, 'failed');
		source.failureChannel = 'archive_evidence';
		const matching = verifiedObject(matchingRoot, '9'.repeat(64));
		const mismatching = verifiedObject(mismatchingRoot, '8'.repeat(64));
		const matchingInputs = proofInputs(matchingRoot, matching);
		const mismatchingInputs = proofInputs(mismatchingRoot, mismatching);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				source,
				...Object.values(matchingInputs),
				...Object.values(mismatchingInputs)
			]);
		await dataSource.getRepository(HistoryArchiveObjectEvent).save(
			new HistoryArchiveObjectEvent({
				archiveUrl: source.archiveUrl,
				archiveUrlIdentity: source.archiveUrlIdentity,
				eventType: 'verified',
				evidenceClass: 'archive-object',
				objectKey: source.objectKey,
				objectRemoteId: source.remoteId,
				objectType: source.objectType,
				objectUrl: source.objectUrl,
				verificationFacts: {
					content: {
						algorithm: 'sha256',
						digest: '9'.repeat(64),
						representation: 'uncompressed-xdr'
					}
				}
			})
		);
		await dataSource
			.getRepository(HistoryArchiveStateSnapshot)
			.save([
				state(targetRoot, networkPassphrase),
				state(matchingRoot, networkPassphrase),
				state(mismatchingRoot, networkPassphrase)
			]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save([
				proof(matchingRoot, matchingInputs),
				proof(mismatchingRoot, mismatchingInputs)
			]);

		const result = await findVerifiedCheckpointObjectSources(
			dataSource.manager,
			[source.remoteId],
			5,
			publicResolver
		);

		expect(result).toEqual([
			expect.objectContaining({
				anchorKind: 'target-digest',
				archiveUrlIdentity: matchingRoot,
				contentDigest: '9'.repeat(64)
			})
		]);
	});

	it('rejects competing independently corroborated digests without a target anchor', async () => {
		const source = object(targetRoot, 'failed');
		source.failureChannel = 'archive_evidence';
		const roots = [
			'https://first-a.example.com',
			'https://first-b.example.com',
			'https://second-a.example.com',
			'https://second-b.example.com'
		] as const;
		const fixtures = roots.map((root, index) => {
			const candidate = verifiedObject(
				root,
				(index < 2 ? '1' : '2').repeat(64)
			);
			return { candidate, inputs: proofInputs(root, candidate), root };
		});
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				source,
				...fixtures.flatMap(({ inputs }) => Object.values(inputs))
			]);
		await dataSource
			.getRepository(HistoryArchiveStateSnapshot)
			.save([
				state(targetRoot, networkPassphrase),
				...fixtures.map(({ root }) => state(root, networkPassphrase))
			]);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save(fixtures.map(({ inputs, root }) => proof(root, inputs)));

		await expect(
			findVerifiedCheckpointObjectSources(
				dataSource.manager,
				[source.remoteId],
				5,
				publicResolver
			)
		).resolves.toEqual([]);
	});

	it.each<keyof ProofInputs>([
		'checkpointState',
		'ledger',
		'transactions',
		'results'
	])(
		'revokes candidates when the bound %s input changes after proof',
		async (key) => {
			const fixture = await saveConsensusFixture(dataSource);
			await expect(
				findVerifiedCheckpointObjectSources(
					dataSource.manager,
					[fixture.source.remoteId],
					5,
					publicResolver
				)
			).resolves.toHaveLength(2);

			await dataSource.query(
				`update history_archive_object_queue
			 set "updatedAt" = '2100-07-16T00:00:00Z'
			 where "remoteId" = $1`,
				[fixture.validInputs[key].remoteId]
			);

			await expect(
				findVerifiedCheckpointObjectSources(
					dataSource.manager,
					[fixture.source.remoteId],
					5,
					publicResolver
				)
			).resolves.toEqual([]);
		}
	);

	it('requires a new proof when bucket dependencies appear after evaluation', async () => {
		const fixture = await saveConsensusFixture(dataSource);
		const bucketHash = 'b'.repeat(64);
		await expect(
			findVerifiedCheckpointObjectSources(
				dataSource.manager,
				[fixture.source.remoteId],
				5,
				publicResolver
			)
		).resolves.toHaveLength(2);

		await dataSource.query(
			`insert into history_archive_checkpoint_bucket_dependency
				("archiveUrlIdentity", "checkpointLedger", "bucketHash", "createdAt")
			 values ($1, $2, $3, '2100-07-16T00:00:00Z')`,
			[validRoot, checkpointLedger, bucketHash]
		);
		await expect(
			findVerifiedCheckpointObjectSources(
				dataSource.manager,
				[fixture.source.remoteId],
				5,
				publicResolver
			)
		).resolves.toEqual([]);

		const bucket = new HistoryArchiveObject({
			archiveUrl: validRoot,
			archiveUrlIdentity: validRoot,
			bucketHash,
			objectKey: `bucket:${bucketHash}`,
			objectOrder: 40,
			objectType: 'bucket',
			objectUrl: `${validRoot}/bucket/bb/bb/bb/bucket-${bucketHash}.xdr.gz`,
			status: 'verified'
		});
		bucket.verifiedAt = new Date('2100-07-16T00:00:00.000Z');
		await dataSource.getRepository(HistoryArchiveObject).save(bucket);
		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set "evaluatedAt" = '2101-07-16T00:00:00Z',
				 "expectedBucketCount" = 1,
				 "verifiedBucketCount" = 1
			 where "archiveUrlIdentity" = $1 and "checkpointLedger" = $2`,
			[validRoot, checkpointLedger]
		);

		await expect(
			findVerifiedCheckpointObjectSources(
				dataSource.manager,
				[fixture.source.remoteId],
				5,
				publicResolver
			)
		).resolves.toHaveLength(2);
	});
});

async function saveConsensusFixture(dataSource: DataSource): Promise<{
	readonly source: HistoryArchiveObject;
	readonly validInputs: ProofInputs;
}> {
	const source = object(targetRoot, 'failed');
	const valid = verifiedObject(validRoot, '1'.repeat(64));
	const corroborating = verifiedObject(corroboratingRoot, '1'.repeat(64));
	const validInputs = proofInputs(validRoot, valid);
	const corroboratingInputs = proofInputs(corroboratingRoot, corroborating);
	await dataSource
		.getRepository(HistoryArchiveObject)
		.save([
			source,
			...Object.values(validInputs),
			...Object.values(corroboratingInputs)
		]);
	await dataSource
		.getRepository(HistoryArchiveStateSnapshot)
		.save([
			state(targetRoot, networkPassphrase),
			state(validRoot, networkPassphrase),
			state(corroboratingRoot, networkPassphrase)
		]);
	await dataSource
		.getRepository(HistoryArchiveCheckpointProof)
		.save([
			proof(validRoot, validInputs),
			proof(corroboratingRoot, corroboratingInputs)
		]);
	return { source, validInputs };
}

function object(
	archiveUrl: string,
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger,
		objectKey,
		objectOrder: 30,
		objectType: 'transactions',
		objectUrl: `${archiveUrl}/transactions/00/00/00/transactions-0000003f.xdr.gz`,
		status
	});
}

type ProofInputs = {
	readonly checkpointState: HistoryArchiveObject;
	readonly ledger: HistoryArchiveObject;
	readonly results: HistoryArchiveObject;
	readonly transactions: HistoryArchiveObject;
};

function proofInputs(
	archiveUrl: string,
	transactions: HistoryArchiveObject
): ProofInputs {
	const create = (
		objectType: HistoryArchiveObject['objectType']
	): HistoryArchiveObject => {
		const input = new HistoryArchiveObject({
			archiveUrl,
			archiveUrlIdentity: archiveUrl,
			checkpointLedger,
			objectKey: `${objectType}:0000003f`,
			objectOrder: 20,
			objectType,
			objectUrl: `${archiveUrl}/${objectType}/0000003f`,
			status: 'verified'
		});
		input.verifiedAt = new Date('2026-07-16T00:00:00.000Z');
		return input;
	};
	return {
		checkpointState: create('checkpoint-state'),
		ledger: create('ledger'),
		results: create('results'),
		transactions
	};
}

function verifiedObject(
	archiveUrl: string,
	contentDigest: string
): HistoryArchiveObject {
	const candidate = object(archiveUrl, 'verified');
	candidate.verifiedAt = new Date('2026-07-16T00:00:00.000Z');
	candidate.verificationFacts = {
		content: {
			algorithm: 'sha256',
			digest: contentDigest,
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
	inputs: ProofInputs
): HistoryArchiveCheckpointProof {
	return Object.assign(new HistoryArchiveCheckpointProof(), {
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketsVerified: true,
		checkpointBucketListHash: 'a'.repeat(64),
		checkpointBucketListMatches: true,
		checkpointLedger,
		checkpointStateObjectRemoteId: inputs.checkpointState.remoteId,
		evaluatedAt: new Date('2099-07-16T00:01:00.000Z'),
		expectedBucketCount: 0,
		failedBucketCount: 0,
		failureKind: null,
		ledgerBucketListHash: 'a'.repeat(64),
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
		verifiedBucketCount: 0
	} satisfies Partial<HistoryArchiveCheckpointProof>);
}
