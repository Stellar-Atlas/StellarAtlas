import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import { HistoryArchiveStateSnapshot } from '../../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { GetKnownArchiveEvidence } from '../../../../use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { TypeOrmKnownArchiveEvidenceRepository } from '../TypeOrmKnownArchiveEvidenceRepository.js';
import { findKnownArchiveObjectPage } from '../KnownArchiveObjectPageQuery.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	createEvidenceCursorCodec as createCursorCodec,
	createEvidenceEvent as createEvent,
	createEvidenceObject as createObject,
	createKnownEvidenceDataSource,
	evidenceBucketHash as bucketHash,
	evidenceBucketKey as bucketKey,
	evidenceNetworkRoot as networkRoot,
	evidenceRootA as rootA,
	evidenceRootB as rootB,
	insertEvidenceCheckpointProofs as insertCheckpointProofs,
	requireEvidenceCursor as requireCursor,
	resetKnownEvidence,
	saveEvidenceNetworkStates,
	setEvidenceBucketProof as setBucketProof,
	setEvidenceContentProof as setContentProof,
	setEvidenceEventTime,
	setEvidenceObjectTime
} from './KnownArchiveEvidenceRepositoryFixture.js';

jest.setTimeout(60_000);

describe('TypeOrmKnownArchiveEvidenceRepository', () => {
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

	it('projects host backoff and its expiry into composed object pages', async () => {
		const pending = createObject(
			rootA,
			'checkpoint-state:0000003f',
			'checkpoint-state',
			'pending'
		);
		await dataSource.getRepository(HistoryArchiveObject).save(pending);
		await dataSource.query(
			`insert into history_archive_object_host_throttle
				("hostIdentity", "blockedUntil") values ($1, $2)`,
			['history-a.example.com', '2027-07-10T01:05:00.000Z']
		);

		const page = await findKnownArchiveObjectPage(dataSource.manager, [rootA], {
			before: null,
			filters: {
				archiveUrlIdentity: rootA,
				objectType: 'checkpoint-state',
				status: 'pending'
			},
			limit: 10,
			snapshotAt: new Date('2027-07-10T01:00:00.000Z'),
			snapshotTotal: null
		});

		expect(page.objects[0]?.delayReason).toEqual({
			code: 'host-backoff',
			until: '2027-07-10T01:05:00.000Z'
		});
	});

	it('keeps live status pages duplicate-safe and recounts each request', async () => {
		const newest = createObject(rootA, 'ledger:000000bf', 'ledger', 'pending');
		const middle = createObject(rootA, 'ledger:0000007f', 'ledger', 'pending');
		const oldest = createObject(rootA, 'ledger:0000003f', 'ledger', 'pending');
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([newest, middle, oldest]);
		await setEvidenceObjectTime(dataSource, newest, '2026-07-10T03:00:00.000Z');
		await setEvidenceObjectTime(dataSource, middle, '2026-07-10T02:00:00.000Z');
		await setEvidenceObjectTime(dataSource, oldest, '2026-07-10T01:00:00.000Z');
		const useCase = new GetKnownArchiveEvidence(
			new TypeOrmKnownArchiveEvidenceRepository(dataSource),
			mock<ExceptionLogger>(),
			createCursorCodec()
		);
		const input = {
			nodePublicKeys: ['GA'],
			roots: [
				{
					archiveUrl: rootA,
					archiveUrlIdentity: rootA,
					nodePublicKeys: ['GA']
				}
			],
			sameOrganizationArchiveUrlIdentities: [rootA]
		};
		const first = (
			await useCase.execute({
				...input,
				options: { objectLimit: 1, objectStatus: 'pending' }
			})
		)._unsafeUnwrap();
		expect(first.objectPage).toMatchObject({
			objects: [{ remoteId: newest.remoteId }],
			page: { hasMore: true, total: 3 }
		});

		await dataSource.query(
			`update history_archive_object_queue
			 set status = 'verified', "verifiedAt" = now(), "updatedAt" = now()
			 where "remoteId" = $1`,
			[newest.remoteId]
		);
		const second = (
			await useCase.execute({
				...input,
				options: {
					objectCursor: requireCursor(first.objectPage.page.nextCursor),
					objectLimit: 1,
					objectStatus: 'pending'
				}
			})
		)._unsafeUnwrap();

		expect(second.objectPage).toMatchObject({
			objects: [{ remoteId: middle.remoteId }],
			page: { hasMore: true, total: 2 }
		});
		expect(second.objectPage.objects).not.toContainEqual(
			expect.objectContaining({ remoteId: newest.remoteId })
		);
	});

	it('paginates persisted evidence and classifies verified copies', async () => {
		const remoteFailure = createObject(rootA, bucketKey, 'bucket', 'failed');
		remoteFailure.errorType = 'archive_http_error';
		remoteFailure.errorMessage = 'remote bucket missing';
		remoteFailure.failureChannel = 'archive_evidence';
		remoteFailure.httpStatus = 404;
		const workerIssue = createObject(
			rootA,
			'ledger:0000003f',
			'ledger',
			'failed'
		);
		workerIssue.errorType = 'worker_setup_failed';
		workerIssue.errorMessage = 'local setup failed';
		workerIssue.failureChannel = 'scanner_issue';
		const sameOrganizationCopy = createObject(
			rootB,
			bucketKey,
			'bucket',
			'verified'
		);
		sameOrganizationCopy.objectUrl = `${rootB}/Bucket/AA/Object.xdr.gz?token=AbC`;
		const pending = createObject(
			rootB,
			'checkpoint-state:0000003f',
			'checkpoint-state',
			'pending'
		);
		const networkCopy = createObject(
			networkRoot,
			bucketKey,
			'bucket',
			'verified'
		);
		setBucketProof(sameOrganizationCopy);
		setBucketProof(networkCopy);
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([
				remoteFailure,
				workerIssue,
				sameOrganizationCopy,
				pending,
				networkCopy
			]);
		await setEvidenceObjectTime(
			dataSource,
			remoteFailure,
			'2026-07-10T04:00:00.000Z'
		);
		await setEvidenceObjectTime(
			dataSource,
			workerIssue,
			'2026-07-10T03:00:00.000Z'
		);
		await setEvidenceObjectTime(
			dataSource,
			sameOrganizationCopy,
			'2026-07-10T02:00:00.000Z'
		);
		await setEvidenceObjectTime(
			dataSource,
			pending,
			'2026-07-10T01:00:00.000Z'
		);
		await setEvidenceObjectTime(
			dataSource,
			networkCopy,
			'2026-07-10T00:00:00.000Z'
		);
		await saveEvidenceNetworkStates(dataSource, [
			[rootA, 'Public Global Stellar Network ; September 2015'],
			[rootB, 'Public Global Stellar Network ; September 2015'],
			[networkRoot, 'Public Global Stellar Network ; September 2015']
		]);

		const firstEvent = createEvent(remoteFailure, 'failed', 'archive-object');
		const secondEvent = createEvent(sameOrganizationCopy, 'verified', null);
		await dataSource
			.getRepository(HistoryArchiveObjectEvent)
			.save([firstEvent, secondEvent]);
		await setEvidenceEventTime(
			dataSource,
			firstEvent,
			'2026-07-10T04:00:00.000Z'
		);
		await setEvidenceEventTime(
			dataSource,
			secondEvent,
			'2026-07-10T03:00:00.000Z'
		);
		await insertCheckpointProofs(dataSource);

		const useCase = new GetKnownArchiveEvidence(
			new TypeOrmKnownArchiveEvidenceRepository(dataSource),
			mock<ExceptionLogger>(),
			createCursorCodec()
		);
		const input = {
			nodePublicKeys: ['GA', 'GB'],
			roots: [
				{
					archiveUrl: rootA,
					archiveUrlIdentity: rootA,
					nodePublicKeys: ['GA']
				},
				{ archiveUrl: rootB, archiveUrlIdentity: rootB, nodePublicKeys: ['GB'] }
			],
			sameOrganizationArchiveUrlIdentities: [rootA, rootB]
		};
		const first = (
			await useCase.execute({
				...input,
				options: {
					copyLimit: 2,
					eventLimit: 1,
					failureLimit: 1,
					objectLimit: 1,
					workerIssueLimit: 1
				}
			})
		)._unsafeUnwrap();

		expect(first.roots).toHaveLength(2);
		expect(first.totals).toMatchObject({
			archiveRoots: 2,
			checkpoints: {
				mismatchedCheckpoints: 1,
				totalCheckpoints: 2,
				verifiedCheckpoints: 1
			},
			objects: {
				remoteFailureObjects: 1,
				totalObjects: 4,
				workerIssueObjects: 1
			}
		});
		expect(first.objectPage).toMatchObject({
			objects: [{ remoteId: remoteFailure.remoteId }],
			page: { hasMore: true, limit: 1, total: 4 }
		});
		expect(first.eventPage).toMatchObject({
			events: [{ remoteId: firstEvent.remoteId }],
			page: { hasMore: true, limit: 1, total: 2 }
		});
		expect(first.remoteFailures.failures[0]).toMatchObject({
			networkVerifiedCopies: {
				copies: [{ archiveUrlIdentity: networkRoot }],
				count: 1
			},
			sameOrganizationVerifiedCopies: {
				copies: [
					{
						archiveUrlIdentity: rootB,
						objectUrl: `${rootB}/Bucket/AA/Object.xdr.gz?token=AbC`
					}
				],
				count: 1
			}
		});
		expect(first.workerIssues).toMatchObject({
			issues: [{ evidenceClass: 'worker-infrastructure' }],
			total: 1
		});
		await dataSource.query(
			'update history_archive_object_queue set "updatedAt" = $1 where "remoteId" = $2',
			['2026-07-11T00:00:00.000Z', workerIssue.remoteId]
		);

		const second = (
			await useCase.execute({
				...input,
				options: {
					eventCursor: requireCursor(first.eventPage.page.nextCursor),
					eventLimit: 1,
					objectCursor: requireCursor(first.objectPage.page.nextCursor),
					objectLimit: 1
				}
			})
		)._unsafeUnwrap();

		expect(second.objectPage.objects[0]?.remoteId).toBe(workerIssue.remoteId);
		expect(second.objectPage.page.total).toBe(4);
		expect(second.eventPage.events[0]?.remoteId).toBe(secondEvent.remoteId);
		expect(second.eventPage.page.total).toBe(2);
	});

	it('excludes cross-network and divergent-content repair copies', async () => {
		const objectKey = 'ledger:0000003f';
		const source = createObject(rootA, objectKey, 'ledger', 'failed');
		source.failureChannel = 'archive_evidence';
		source.errorMessage = 'remote object unavailable';
		source.errorType = 'archive_http_error';
		setContentProof(source, '1'.repeat(64));
		const valid = createObject(rootB, objectKey, 'ledger', 'verified');
		valid.objectUrl = `${rootB}/Ledger/00/00/3F.xdr.gz?token=CaseSensitive`;
		setContentProof(valid, '1'.repeat(64));
		const testnet = createObject(networkRoot, objectKey, 'ledger', 'verified');
		setContentProof(testnet, '1'.repeat(64));
		const divergentRoot = 'https://divergent.example.com';
		const divergent = createObject(
			divergentRoot,
			objectKey,
			'ledger',
			'verified'
		);
		setContentProof(divergent, '2'.repeat(64));
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([source, valid, testnet, divergent]);
		await saveEvidenceNetworkStates(dataSource, [
			[rootA, 'Public Global Stellar Network ; September 2015'],
			[rootB, 'Public Global Stellar Network ; September 2015'],
			[networkRoot, 'Test SDF Network ; September 2015'],
			[divergentRoot, 'Public Global Stellar Network ; September 2015']
		]);

		const result = await new GetKnownArchiveEvidence(
			new TypeOrmKnownArchiveEvidenceRepository(dataSource),
			mock<ExceptionLogger>(),
			createCursorCodec()
		).execute({
			nodePublicKeys: ['GA'],
			options: { failureLimit: 10 },
			roots: [
				{ archiveUrl: rootA, archiveUrlIdentity: rootA, nodePublicKeys: ['GA'] }
			],
			sameOrganizationArchiveUrlIdentities: [rootA, rootB]
		});

		const failure = result._unsafeUnwrap().remoteFailures.failures[0];
		expect(failure?.sameOrganizationVerifiedCopies).toMatchObject({
			copies: [
				{
					archiveUrlIdentity: rootB,
					objectUrl: `${rootB}/Ledger/00/00/3F.xdr.gz?token=CaseSensitive`
				}
			],
			count: 1
		});
		expect(failure?.networkVerifiedCopies).toMatchObject({
			copies: [],
			count: 0
		});
	});

	it('uses verified canonical identity for a missing non-bucket file', async () => {
		const objectKey = 'transactions:0000003f';
		const missing = createObject(rootA, objectKey, 'transactions', 'failed');
		missing.failureChannel = 'archive_evidence';
		missing.errorMessage = 'remote object unavailable';
		missing.errorType = 'archive_http_error';
		missing.httpStatus = 404;
		const verified = createObject(rootB, objectKey, 'transactions', 'verified');
		verified.objectUrl = `${rootB}/transactions/00/00/00/transactions-0000003f.xdr.gz`;
		setContentProof(verified, '7'.repeat(64));
		const scpMissing = createObject(rootA, 'scp:0000003f', 'scp', 'failed');
		scpMissing.failureChannel = 'archive_evidence';
		scpMissing.errorMessage = 'remote object unavailable';
		scpMissing.errorType = 'archive_http_error';
		scpMissing.httpStatus = 404;
		const scpVerified = createObject(rootB, 'scp:0000003f', 'scp', 'verified');
		setContentProof(scpVerified, '8'.repeat(64));
		await dataSource
			.getRepository(HistoryArchiveObject)
			.save([missing, verified, scpMissing, scpVerified]);
		await saveEvidenceNetworkStates(dataSource, [
			[rootA, 'Public Global Stellar Network ; September 2015'],
			[rootB, 'Public Global Stellar Network ; September 2015']
		]);

		const evidence = (
			await new GetKnownArchiveEvidence(
				new TypeOrmKnownArchiveEvidenceRepository(dataSource),
				mock<ExceptionLogger>(),
				createCursorCodec()
			).execute({
				nodePublicKeys: ['GA', 'GB'],
				options: { copyLimit: 5, failureLimit: 5 },
				roots: [
					{
						archiveUrl: rootA,
						archiveUrlIdentity: rootA,
						nodePublicKeys: ['GA']
					},
					{
						archiveUrl: rootB,
						archiveUrlIdentity: rootB,
						nodePublicKeys: ['GB']
					}
				],
				sameOrganizationArchiveUrlIdentities: [rootA, rootB]
			})
		)._unsafeUnwrap();

		const transactionFailure = evidence.remoteFailures.failures.find(
			(failure) => failure.object.remoteId === missing.remoteId
		);
		const scpFailure = evidence.remoteFailures.failures.find(
			(failure) => failure.object.remoteId === scpMissing.remoteId
		);
		expect(transactionFailure).toMatchObject({
			object: { remoteId: missing.remoteId },
			sameOrganizationVerifiedCopies: {
				copies: [
					{
						archiveUrlIdentity: rootB,
						objectUrl: verified.objectUrl
					}
				],
				count: 1
			}
		});
		expect(scpFailure).toMatchObject({
			networkVerifiedCopies: { copies: [], count: 0 },
			sameOrganizationVerifiedCopies: { copies: [], count: 0 }
		});
	});
});
