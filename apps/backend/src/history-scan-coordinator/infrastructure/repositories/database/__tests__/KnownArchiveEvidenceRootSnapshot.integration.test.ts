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
	evidenceRootB,
	resetKnownEvidence,
	saveEvidenceNetworkStates,
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

	it('reports listing gaps separately, caps continuous coverage, and keeps source identities case-sensitive', async () => {
		const root = `${evidenceRootA}/Archive`;
		const lowerRoot = `${evidenceRootA}/archive`;
		await saveEvidenceNetworkStates(dataSource, [
			[root, 'network'],
			[lowerRoot, 'network'],
			[evidenceRootB, 'network']
		]);
		await dataSource.query(
			'update history_archive_state_snapshot set "currentLedger" = 639'
		);
		const frontier = createCheckpointProof(root, 639);
		const anchor = createCheckpointProof(evidenceRootB, 319);
		await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.save([frontier, anchor]);
		await dataSource.query(
			`insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity", "latestCheckpointLedger", "nextHistoricalCheckpointLedger") values ($1,639,703),($2,639,127)`,
			[root, lowerRoot]
		);
		const before = await readRoots([root, lowerRoot]);
		expect(
			before[0]?.sequentialCoverage.lastContinuouslyVerifiedCheckpointLedger
		).toBe(639);
		await insertGap(root, 127, 319, anchor.id);
		await insertGap(root, 63, 127, null, true);
		const after = await readRoots([root, lowerRoot]);
		expect(after[0]?.listingGapCount).toBe(1);
		expect(after[0]?.listingGaps?.[0]).toMatchObject({
			firstCheckpointLedger: 127,
			lastCheckpointLedger: 319,
			resumeCheckpointLedger: 383,
			checkpointCount: 4,
			sourceCheckpointProofId: String(anchor.id),
			sourceArchiveUrlIdentity: evidenceRootB
		});
		expect(
			after[0]?.sequentialCoverage.lastContinuouslyVerifiedCheckpointLedger
		).toBe(63);
		expect(after[0]?.sequentialCoverage.status).not.toBe('caught-up');
		expect(after[0]?.checkpoints).toEqual(before[0]?.checkpoints);
		expect(after[0]?.objects).toEqual(before[0]?.objects);
		expect(after[1]?.listingGaps).toEqual([]);
		expect(after[1]?.listingGapCount).toBe(0);
		expect(
			after[1]?.sequentialCoverage.lastContinuouslyVerifiedCheckpointLedger
		).toBeNull();
	});

	it('caps a genesis gap at unknown and bounds range samples without truncating their count', async () => {
		for (let index = 0; index < 22; index++)
			await insertGap(evidenceRootA, 63 + index * 192, 127 + index * 192, null);
		await dataSource.query(
			`insert into history_archive_checkpoint_scan_cursor ("archiveUrlIdentity", "latestCheckpointLedger", "nextHistoricalCheckpointLedger") values ($1,6399,6463)`,
			[evidenceRootA]
		);
		const [root] = await readRoots([evidenceRootA]);
		expect(root?.listingGapCount).toBe(22);
		expect(root?.listingGaps).toHaveLength(20);
		expect(root?.listingGaps?.[0]?.firstCheckpointLedger).toBe(63);
		expect(
			root?.sequentialCoverage.lastContinuouslyVerifiedCheckpointLedger
		).toBeNull();
	});

	it('reports a late strict same-network boundary proof without changing the original null-anchor gap', async () => {
		await saveEvidenceNetworkStates(dataSource, [
			[evidenceRootA, 'network'],
			[evidenceRootB, 'another network']
		]);
		await insertGap(evidenceRootA, 127, 319, null);
		const gapRows = () =>
			dataSource.query(
				'select to_jsonb(gap) as evidence from history_archive_listing_gap gap where "archiveUrlIdentity" = $1 and "firstCheckpointLedger" = 127 and "lastCheckpointLedger" = 319',
				[evidenceRootA]
			);
		const original = await gapRows();
		const anchor = createCheckpointProof(evidenceRootB, 319);
		await dataSource.getRepository(HistoryArchiveCheckpointProof).save(anchor);
		const [wrongNetwork] = await readRoots([evidenceRootA]);
		expect(wrongNetwork?.listingGaps?.[0]?.sourceCheckpointProofId).toBeNull();
		await dataSource.query(
			'update history_archive_state_snapshot set "networkPassphrase" = $1 where "archiveUrlIdentity" = $2',
			['network', evidenceRootB]
		);
		const [recovered] = await readRoots([evidenceRootA]);
		expect(recovered?.listingGaps?.[0]).toMatchObject({
			sourceCheckpointProofId: String(anchor.id),
			sourceArchiveUrlIdentity: evidenceRootB,
			firstCheckpointLedger: 127,
			lastCheckpointLedger: 319
		});
		expect(recovered?.listingGapCount).toBe(1);
		expect(recovered?.checkpoints.verifiedCheckpoints).toBe(0);
		expect(await gapRows()).toEqual(original);
	});

	function readRoots(roots: string[]) {
		return findKnownArchiveEvidenceRoots(
			dataSource.manager,
			roots.map((archiveUrl) => ({
				archiveUrl,
				archiveUrlIdentity: archiveUrl
			})),
			new Date('2028-01-01T00:00:00Z')
		);
	}

	async function insertGap(
		root: string,
		first: number,
		last: number,
		sourceProof: number | undefined | null,
		resolved = false
	) {
		const next = last + 64;
		const hex = (value: number) => value.toString(16).padStart(8, '0');
		const evidence = {
			kind: 'gcs-listing-gap',
			archiveRoot: root,
			missingFromCheckpoint: first,
			missingThroughCheckpoint: last,
			observedAt: '2026-09-06T23:00:00Z',
			listings: ['history', 'ledger', 'transactions', 'results'].map(
				(category) => {
					const prefix = `Archive/${category}/`;
					const key = (value: number) =>
						`${prefix}${hex(value).slice(0, 2)}/${hex(value).slice(2, 4)}/${hex(value).slice(4, 6)}/${category}-${hex(value)}${category === 'history' ? '.json' : '.xdr.gz'}`;
					const url = new URL('https://storage.googleapis.com/example');
					url.searchParams.set('prefix', prefix);
					url.searchParams.set('max-keys', '2');
					url.searchParams.set(
						'marker',
						first === 63 ? prefix : key(first - 64)
					);
					return {
						category,
						listingUrl: url.href,
						responseSha256: 'a'.repeat(64),
						firstReturnedKey: key(next),
						firstReturnedCheckpoint: next
					};
				}
			)
		};
		await dataSource.query(
			`insert into history_archive_listing_gap ("archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger", "resumeCheckpointLedger", "observedAt", "listingEvidence", "sourceCheckpointProofId", "resolvedAt") values ($1,$2,$3,$4,$5,$6,$7,$8)`,
			[
				root,
				first,
				last,
				next,
				evidence.observedAt,
				evidence,
				sourceProof ?? null,
				resolved ? evidence.observedAt : null
			]
		);
	}

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
