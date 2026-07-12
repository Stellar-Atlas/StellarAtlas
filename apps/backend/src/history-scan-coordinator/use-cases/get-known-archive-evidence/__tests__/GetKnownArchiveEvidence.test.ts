import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type { KnownArchiveEvidenceRepository } from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { InvalidArchiveEvidenceFilterError } from '../ArchiveEvidencePagination.js';
import { GetKnownArchiveEvidence } from '../GetKnownArchiveEvidence.js';
import { createArchiveEvidenceCursorCodec } from '../ArchiveEvidenceCursorCodec.js';

const rootA = 'https://history-a.example.com';
const rootB = 'https://history-b.example.com';

describe('GetKnownArchiveEvidence', () => {
	it('paginates composed evidence and separates remote failures from worker issues', async () => {
		const repository = mock<KnownArchiveEvidenceRepository>();
		const exceptionLogger = mock<ExceptionLogger>();
		const remoteFailure = createObject(rootA, 'remote-a', 'failed');
		remoteFailure.errorType = 'http_error';
		remoteFailure.failureChannel = 'archive_evidence';
		remoteFailure.httpStatus = 404;
		remoteFailure.errorMessage = 'missing object';
		const remoteFailureNext = createObject(rootB, 'remote-b', 'failed');
		const workerIssue = createObject(rootA, 'worker-a', 'failed');
		workerIssue.errorType = 'worker_io_error';
		workerIssue.failureChannel = 'scanner_issue';
		workerIssue.errorMessage = 'local cache failed';
		const objectNext = createObject(rootB, 'object-next', 'verified');
		const event = createEvent(rootA, 'event-a');
		const eventNext = createEvent(rootB, 'event-b');

		repository.findEvidence.mockResolvedValue({
			copyCoverage: [
				{
					network: {
						copies: [createCopy('https://network.example.com', 'copy-n')],
						count: 4
					},
					sameOrganization: {
						copies: [createCopy(rootB, 'copy-o')],
						count: 1
					},
					sourceRemoteId: remoteFailure.remoteId
				}
			],
			eventPage: { events: [event, eventNext], total: 8 },
			objectPage: { objects: [remoteFailure, objectNext], total: 9 },
			remoteFailures: {
				failures: [
					{ evidenceClass: 'archive-object', object: remoteFailure },
					{ evidenceClass: 'archive-object', object: remoteFailureNext }
				],
				total: 2
			},
			roots: [createRoot(rootA), createRoot(rootB)],
			workerIssues: {
				failures: [
					{ evidenceClass: 'worker-infrastructure', object: workerIssue }
				],
				total: 1
			}
		});

		const result = await new GetKnownArchiveEvidence(
			repository,
			exceptionLogger,
			createCursorCodec()
		).execute({
			nodePublicKeys: ['GB', 'GA', 'GA'],
			options: {
				copyLimit: 1,
				eventLimit: 1,
				failureLimit: 1,
				objectLimit: 1,
				objectStatus: 'failed',
				workerIssueLimit: 1
			},
			roots: [
				{
					archiveUrl: rootA,
					archiveUrlIdentity: rootA,
					nodePublicKeys: ['GA']
				},
				{ archiveUrl: rootB, archiveUrlIdentity: rootB, nodePublicKeys: ['GB'] }
			],
			sameOrganizationArchiveUrlIdentities: [rootA, rootB]
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.nodePublicKeys).toEqual(['GA', 'GB']);
		expect(result.value.totals.nodes).toBe(2);
		expect(result.value.totals.archiveRoots).toBe(2);
		expect(result.value.totals.objects.totalObjects).toBe(20);
		expect(result.value.objectPage).toMatchObject({
			page: { hasMore: true, limit: 1, total: 9 },
			objects: [{ remoteId: remoteFailure.remoteId }]
		});
		expect(result.value.objectPage.page.nextCursor).toEqual(expect.any(String));
		expect(result.value.eventPage.page).toMatchObject({
			hasMore: true,
			limit: 1,
			total: 8
		});
		expect(result.value.remoteFailures).toMatchObject({
			hasMore: true,
			total: 2,
			failures: [
				{
					networkVerifiedCopies: { count: 4, sampleLimit: 1 },
					sameOrganizationVerifiedCopies: { count: 1, sampleLimit: 1 }
				}
			]
		});
		expect(
			result.value.remoteFailures.failures[0]?.sameOrganizationVerifiedCopies
				.copies[0]?.objectUrl
		).toBe(`${rootB}/Case/Object.xdr.gz?token=AbC`);
		expect(result.value.workerIssues).toMatchObject({
			issues: [{ evidenceClass: 'worker-infrastructure' }],
			total: 1
		});
		expect(result.value.remoteFailures.failures[0]?.object.error?.message).toBe(
			'Remote archive returned HTTP 404'
		);
	});

	it('rejects an archive filter outside the entity root scope', async () => {
		const repository = mock<KnownArchiveEvidenceRepository>();
		const exceptionLogger = mock<ExceptionLogger>();
		const result = await new GetKnownArchiveEvidence(
			repository,
			exceptionLogger,
			createCursorCodec()
		).execute({
			nodePublicKeys: ['GA'],
			options: { archiveUrl: 'https://other.example.com' },
			roots: [
				{ archiveUrl: rootA, archiveUrlIdentity: rootA, nodePublicKeys: ['GA'] }
			],
			sameOrganizationArchiveUrlIdentities: [rootA]
		});

		expect(result.isErr()).toBe(true);
		if (result.isOk()) return;
		expect(result.error).toBeInstanceOf(InvalidArchiveEvidenceFilterError);
		expect(repository.findEvidence).not.toHaveBeenCalled();
		expect(exceptionLogger.captureException).not.toHaveBeenCalled();
	});
});

function createObject(
	archiveUrl: string,
	remoteId: string,
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash:
			'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
		objectKey:
			'bucket:4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
		objectOrder: 50,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket/object.xdr.gz`,
		remoteId: toUuid(remoteId),
		status
	});
	object.attempts = 1;
	object.verifiedAt =
		status === 'verified' ? new Date('2026-07-10T00:00:00.000Z') : null;
	(object as HistoryArchiveObject & { createdAt?: Date }).createdAt = new Date(
		'2026-07-09T23:00:00.000Z'
	);
	(object as HistoryArchiveObject & { updatedAt?: Date }).updatedAt = new Date(
		'2026-07-10T00:00:00.000Z'
	);
	return object;
}

function createEvent(
	archiveUrl: string,
	remoteId: string
): HistoryArchiveObjectEvent {
	const event = new HistoryArchiveObjectEvent({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		eventType: 'verified',
		objectKey: 'ledger:0000003f',
		objectRemoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
		objectType: 'ledger',
		objectUrl: `${archiveUrl}/ledger/object.xdr.gz`,
		remoteId: toUuid(remoteId)
	});
	(event as HistoryArchiveObjectEvent & { createdAt?: Date }).createdAt =
		new Date('2026-07-10T00:00:00.000Z');
	return event;
}

function createRoot(archiveUrl: string) {
	return {
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpoints: {
			mismatchedCheckpoints: 1,
			notEvaluableCheckpoints: 1,
			pendingCheckpoints: 1,
			totalCheckpoints: 4,
			verifiedCheckpoints: 1
		},
		latestObjectAt: new Date('2026-07-10T00:00:00.000Z'),
		objects: {
			activeObjects: 1,
			bucketObjects: 4,
			pendingObjects: 2,
			remoteFailureObjects: 1,
			totalObjects: 10,
			verifiedBucketObjects: 2,
			verifiedObjects: 6,
			workerIssueObjects: 0
		},
		scannerOwnedState: null
	};
}

function createCopy(archiveUrl: string, remoteId: string) {
	return {
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		objectUrl: `${archiveUrl}/Case/Object.xdr.gz?token=AbC`,
		remoteId: toUuid(remoteId),
		verifiedAt: new Date('2026-07-10T00:00:00.000Z')
	};
}

function toUuid(value: string): string {
	const suffix = value
		.split('')
		.reduce((total, character) => total + character.charCodeAt(0), 0)
		.toString(16)
		.padStart(12, '0')
		.slice(-12);
	return `11111111-1111-4111-8111-${suffix}`;
}

function createCursorCodec() {
	return createArchiveEvidenceCursorCodec({
		encodedKeys: `test:${Buffer.alloc(32, 7).toString('base64url')}`,
		nodeEnv: 'test'
	});
}
