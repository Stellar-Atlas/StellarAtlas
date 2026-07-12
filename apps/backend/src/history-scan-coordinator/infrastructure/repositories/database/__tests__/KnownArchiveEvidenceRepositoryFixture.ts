import { DataSource } from 'typeorm';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { HistoryArchiveStateSnapshot } from '../../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { createArchiveEvidenceCursorCodec } from '../../../../use-cases/get-known-archive-evidence/ArchiveEvidenceCursorCodec.js';
import { HistoryArchiveEvidenceRootSummaryMigration1784950000000 } from '../../../database/migrations/1784950000000-HistoryArchiveEvidenceRootSummaryMigration.js';
import { HistoryArchiveObjectEventSummaryMigration1785000000000 } from '../../../database/migrations/1785000000000-HistoryArchiveObjectEventSummaryMigration.js';

export const evidenceRootA = 'https://history-a.example.com';
export const evidenceRootB = 'https://history-b.example.com';
export const evidenceNetworkRoot = 'https://network.example.com';
export const evidenceBucketHash = 'a'.repeat(64);
export const evidenceBucketKey = `bucket:${evidenceBucketHash}`;

export async function createKnownEvidenceDataSource(
	url: string
): Promise<DataSource> {
	const dataSource = new DataSource({
		dropSchema: true,
		entities: [
			HistoryArchiveCheckpointProof,
			HistoryArchiveObject,
			HistoryArchiveObjectEvent,
			HistoryArchiveStateSnapshot
		],
		logging: false,
		synchronize: true,
		type: 'postgres',
		url
	});
	await dataSource.initialize();
	await dataSource.query(`
		create table history_archive_object_host_throttle (
			"hostIdentity" text primary key,
			"blockedUntil" timestamptz not null
		)
	`);
	const migrationRunner = dataSource.createQueryRunner();
	await migrationRunner.connect();
	try {
		await new HistoryArchiveEvidenceRootSummaryMigration1784950000000().up(
			migrationRunner
		);
		await new HistoryArchiveObjectEventSummaryMigration1785000000000().up(
			migrationRunner
		);
	} finally {
		await migrationRunner.release();
	}
	return dataSource;
}

export async function resetKnownEvidence(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(
		'truncate history_archive_object_event, history_archive_checkpoint_proof, history_archive_object_queue, history_archive_state_snapshot, history_archive_object_host_throttle restart identity cascade'
	);
}

export function createEvidenceObject(
	archiveUrl: string,
	objectKey: string,
	objectType: HistoryArchiveObject['objectType'],
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash: objectType === 'bucket' ? evidenceBucketHash : null,
		checkpointLedger: objectType === 'bucket' ? null : 63,
		objectKey,
		objectOrder: 10,
		objectType,
		objectUrl: `${archiveUrl}/${objectKey}.xdr.gz`,
		status
	});
	object.verifiedAt =
		status === 'verified' ? new Date('2026-07-10T00:00:00.000Z') : null;
	return object;
}

export function createEvidenceEvent(
	object: HistoryArchiveObject,
	eventType: HistoryArchiveObjectEvent['eventType'],
	evidenceClass: HistoryArchiveObjectEvent['evidenceClass']
): HistoryArchiveObjectEvent {
	return new HistoryArchiveObjectEvent({
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		eventType,
		evidenceClass,
		failureChannel: object.failureChannel,
		objectKey: object.objectKey,
		objectRemoteId: object.remoteId,
		objectType: object.objectType,
		objectUrl: object.objectUrl,
		verificationFacts: object.verificationFacts
	});
}

export async function setEvidenceObjectTime(
	dataSource: DataSource,
	object: HistoryArchiveObject,
	value: string
): Promise<void> {
	await dataSource.query(
		'update history_archive_object_queue set "createdAt" = $1, "updatedAt" = $1 where "remoteId" = $2',
		[value, object.remoteId]
	);
}

export async function setEvidenceEventTime(
	dataSource: DataSource,
	event: HistoryArchiveObjectEvent,
	value: string
): Promise<void> {
	await dataSource.query(
		'update history_archive_object_event set "createdAt" = $1 where "remoteId" = $2',
		[value, event.remoteId]
	);
}

export async function insertEvidenceCheckpointProofs(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(
		`
		insert into history_archive_checkpoint_proof (
			"archiveUrl", "archiveUrlIdentity", "checkpointLedger", status,
			"requiredObjectsComplete", "proofFactsComplete",
			"checkpointBucketListMatches", "transactionsMatch", "resultsMatch",
			"previousLedgersMatch", "bucketsVerified", "ledgerFactCount",
			"transactionFactCount", "resultFactCount", "expectedBucketCount",
			"verifiedBucketCount", "failedBucketCount", "missingBucketCount",
			"evaluatedAt", "createdAt", "updatedAt"
		) values
			($1, $1, 63, 'verified', true, true, true, true, true, true, true,
			 64, 64, 64, 1, 1, 0, 0, now(), now(), now()),
			($2, $2, 63, 'mismatch', true, true, false, true, true, true, true,
			 64, 64, 64, 1, 1, 0, 0, now(), now(), now())
		`,
		[evidenceRootA, evidenceRootB]
	);
}

export async function saveEvidenceNetworkStates(
	dataSource: DataSource,
	states: readonly (readonly [string, string])[]
): Promise<void> {
	await dataSource.getRepository(HistoryArchiveStateSnapshot).save(
		states.map(
			([archiveUrl, networkPassphrase]) =>
				new HistoryArchiveStateSnapshot({
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
					networkPassphrase,
					observedAt: new Date(),
					rawState: null,
					server: 'stellar-core',
					source: 'history-scanner',
					stateUrl: `${archiveUrl}/.well-known/stellar-history.json`,
					status: 'available',
					version: 1
				})
		)
	);
}

export function setEvidenceBucketProof(object: HistoryArchiveObject): void {
	object.verificationFacts = {
		bucketObject: {
			expectedBucketHash: evidenceBucketHash,
			hashAlgorithm: 'sha256',
			matched: true
		},
		content: {
			algorithm: 'sha256',
			digest: evidenceBucketHash,
			representation: 'uncompressed-xdr'
		}
	};
}

export function setEvidenceContentProof(
	object: HistoryArchiveObject,
	digest: string
): void {
	object.verificationFacts = {
		content: { algorithm: 'sha256', digest, representation: 'uncompressed-xdr' }
	};
}

export function createEvidenceCursorCodec() {
	return createArchiveEvidenceCursorCodec({
		encodedKeys: `postgres:${Buffer.alloc(32, 9).toString('base64url')}`,
		nodeEnv: 'test'
	});
}

export function requireEvidenceCursor(value: string | null): string {
	if (value === null) throw new Error('Expected a next-page cursor');
	return value;
}
