import type { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	HistoryArchiveCheckpointProof
} from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { findKnownArchiveEvidenceRoots } from '../KnownArchiveEvidenceRootQuery.js';
import {
	createEvidenceObject,
	createKnownEvidenceDataSource,
	evidenceRootA,
	resetKnownEvidence,
	setEvidenceObjectTime
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(180_000);

describe('KnownArchiveEvidenceRootQuery snapshot', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = await createKnownEvidenceDataSource(postgres.url);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await resetKnownEvidence(dataSource);
	});

	it('excludes future proofs and reports the latest object at the snapshot', async () => {
		const object = createEvidenceObject(
			evidenceRootA,
			'ledger:0000003f',
			'ledger',
			'verified'
		);
		await dataSource.getRepository(HistoryArchiveObject).save(object);
		await setEvidenceObjectTime(dataSource, object, '2026-01-01T00:00:00.000Z');

		const proof = createCheckpointProof(evidenceRootA, 63);
		await dataSource.getRepository(HistoryArchiveCheckpointProof).save(proof);
		await dataSource.query(
			`update history_archive_checkpoint_proof
			 set "createdAt" = '2027-01-01T00:00:00.000Z'
			 where id = $1`,
			[proof.id]
		);

		const beforeProof = await findKnownArchiveEvidenceRoots(
			dataSource.manager,
			[{ archiveUrl: evidenceRootA, archiveUrlIdentity: evidenceRootA }],
			new Date('2026-12-31T00:00:00.000Z')
		);
		expect(beforeProof[0]?.latestObjectAt?.toISOString()).toBe(
			'2026-01-01T00:00:00.000Z'
		);
		expect(beforeProof[0]?.checkpoints.totalCheckpoints).toBe(0);

		const afterProof = await findKnownArchiveEvidenceRoots(
			dataSource.manager,
			[{ archiveUrl: evidenceRootA, archiveUrlIdentity: evidenceRootA }],
			new Date('2027-01-02T00:00:00.000Z')
		);
		expect(afterProof[0]?.checkpoints.totalCheckpoints).toBe(1);
		expect(afterProof[0]?.checkpoints.verifiedCheckpoints).toBe(1);
	});
});

function createCheckpointProof(
	archiveUrl: string,
	checkpointLedger: number
): HistoryArchiveCheckpointProof {
	return Object.assign(new HistoryArchiveCheckpointProof(), {
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketsVerified: true,
		checkpointBucketListHash: 'a'.repeat(64),
		checkpointBucketListMatches: true,
		checkpointLedger,
		checkpointStateObjectRemoteId: null,
		evaluatedAt: new Date('2027-01-01T00:00:00.000Z'),
		expectedBucketCount: 0,
		failedBucketCount: 0,
		failureKind: null,
		ledgerBucketListHash: 'a'.repeat(64),
		ledgerFactCount: 64,
		ledgerObjectRemoteId: null,
		missingBucketCount: 0,
		previousLedgersMatch: true,
		proofFactsComplete: true,
		proofVersion: CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
		requiredObjectsComplete: true,
		resultFactCount: 64,
		resultsMatch: true,
		resultsObjectRemoteId: null,
		scpObjectRemoteId: null,
		status: 'verified',
		transactionFactCount: 64,
		transactionsMatch: true,
		transactionsObjectRemoteId: null,
		verifiedBucketCount: 0
	} satisfies Partial<HistoryArchiveCheckpointProof>);
}
