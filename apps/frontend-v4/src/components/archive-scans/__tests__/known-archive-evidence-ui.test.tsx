/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
	PublicHistoryArchiveObject,
	PublicKnownNodeArchiveEvidence
} from '../../../api/archive-evidence-types';
import { getArchiveScanDetailPath } from '../../../domain/archive-scan-routes';
import { KnownArchiveEvidence } from '../known-archive-evidence';
import {
	ArchiveActivityTable,
	ArchiveRootSummaryTable,
	RepairDownloadTable
} from '../known-archive-evidence-tables';
import {
	ObjectSource,
	VerifiedCopyLinks,
	formatEventType,
	formatObjectStatusDetail
} from '../known-archive-evidence-table-parts';

describe('known archive evidence UI', () => {
	it('renders accessible tabs with the raw response label', () => {
		const markup = renderToStaticMarkup(
			createElement(KnownArchiveEvidence, {
				evidence: createEvidence(),
				subject: { id: 'GNODE', kind: 'node' },
				title: 'Archive evidence'
			})
		);

		expect(markup).toContain('role="tablist"');
		expect(markup).toContain('aria-orientation="horizontal"');
		expect(markup).toContain('role="tab"');
		expect(markup).toContain('Raw response');
	});

	it('uses the exact persisted verified-copy objectUrl and never synthesizes one', () => {
		const validEvidence = createEvidence();
		const invalidEvidence = createEvidence('file:///srv/private/object.xdr.gz');
		const validFailure = validEvidence.remoteFailures.failures[0];
		const invalidFailure = invalidEvidence.remoteFailures.failures[0];

		if (validFailure === undefined || invalidFailure === undefined) {
			throw new Error('Expected archive evidence failures');
		}

		const exactUrl =
			validFailure.sameOrganizationVerifiedCopies.copies[0]?.objectUrl;
		if (exactUrl === undefined) {
			throw new Error('Expected a persisted verified-copy object URL');
		}
		const validMarkup = renderToStaticMarkup(
			createElement(VerifiedCopyLinks, {
				failure: validFailure,
				relation: 'same-organization'
			})
		);
		const invalidMarkup = renderToStaticMarkup(
			createElement(VerifiedCopyLinks, {
				failure: invalidFailure,
				relation: 'same-organization'
			})
		);

		expect(validMarkup).toContain(`href="${exactUrl}"`);
		expect(validMarkup).not.toContain('href="https://copy.example/history"');
		expect(invalidMarkup).toContain('No proven object URL');
		expect(invalidMarkup).not.toContain('href=');
	});

	it('separates an unverified remote location from verified replacements', () => {
		const evidence = createEvidence();
		const markup = renderToStaticMarkup(
			createElement(RepairDownloadTable, { page: evidence.remoteFailures })
		);

		expect(markup).toContain('Unverified remote location');
		expect(markup).toContain('Not a verified replacement');
		expect(markup).toContain('Verified organization replacements');
		expect(markup).toContain('Download verified file from');
	});

	it('routes archive-source labels to StellarAtlas archive detail', () => {
		const evidence = createEvidence();
		const object = evidence.objectPage.objects[0];
		if (object === undefined) throw new Error('Expected archive object');
		const archivePath = getArchiveScanDetailPath(object.archiveUrl);
		const sourceMarkup = renderToStaticMarkup(
			createElement(ObjectSource, { object })
		);
		const summaryMarkup = renderToStaticMarkup(
			createElement(ArchiveRootSummaryTable, { roots: evidence.roots })
		);
		const activityMarkup = renderToStaticMarkup(
			createElement(ArchiveActivityTable, {
				page: {
					...evidence.eventPage,
					events: [createEvent(object)]
				}
			})
		);

		for (const markup of [sourceMarkup, summaryMarkup, activityMarkup]) {
			expect(markup).toContain(`href="${archivePath}"`);
			expect(markup).not.toContain(`href="${object.archiveUrl}"`);
			expect(markup).not.toContain(`href="${object.objectUrl}"`);
			expect(markup).not.toContain('target="_blank"');
		}
	});

	it('maps planning-deferred delay reasons to scanner-planning copy', () => {
		expect(
			formatObjectStatusDetail(
				createObject({
					delayReason: { code: 'planning-deferred', until: null }
				})
			)
		).toBe('deferred by scanner planning');
	});

	it('describes migrated deferred rows without legacy implementation language', () => {
		const detail = formatObjectStatusDetail(
			createObject({
				delayReason: { code: 'legacy-deferred', until: null }
			})
		);

		expect(detail).toBe('waiting for scanner planning details');
		expect(detail).not.toContain('legacy');
	});

	it('shows retained state separately from a later failed refresh', () => {
		const evidence = createEvidence();
		const root = evidence.roots[0];
		if (root === undefined) throw new Error('Expected archive root');
		const markup = renderToStaticMarkup(
			createElement(ArchiveRootSummaryTable, {
				roots: [{ ...root, scannerOwnedState: createArchiveState() }]
			})
		);

		expect(markup).toContain('Last stored state');
		expect(markup).toContain('Latest refresh failed');
		expect(markup).toContain('History archive state');
		expect(markup).toContain('State current ledger');
		expect(markup).toContain('63,378,495');
	});

	it('shows when a timed delay expires', () => {
		const detail = formatObjectStatusDetail(
			createObject({
				delayReason: {
					code: 'host-backoff',
					until: '2026-07-09T12:05:00.000Z'
				}
			})
		);

		expect(detail).toContain('host backoff until');
		expect(detail).toContain('2026');
	});

	it('renders machine event codes as readable labels', () => {
		expect(formatEventType('download_started')).toBe('Download started');
		expect(formatEventType('proof-refresh-failed')).toBe(
			'Proof refresh failed'
		);
	});
});

function createEvidence(
	copyObjectUrl = 'https://copy.example/history/bucket/aa/bb/object.xdr.gz?token=AbC'
): PublicKnownNodeArchiveEvidence {
	const page = {
		hasMore: false,
		limit: 10,
		nextCursor: null,
		snapshotAt: '2026-07-10T00:00:00.000Z',
		total: 1
	};
	const object = createObject();
	return {
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: null,
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page: { ...page, total: 0 }
		},
		generatedAt: '2026-07-10T00:00:00.000Z',
		nodePublicKeys: ['GNODE'],
		objectPage: {
			filters: {
				archiveUrlIdentity: null,
				objectType: null,
				status: 'pending'
			},
			objects: [object],
			page
		},
		organizationId: null,
		publicKey: 'GNODE',
		remoteFailures: {
			failures: [
				{
					networkVerifiedCopies: {
						copies: [],
						count: 0,
						sampleLimit: 10
					},
					object,
					sameOrganizationVerifiedCopies: {
						copies: [
							{
								archiveUrl: 'https://copy.example/history',
								archiveUrlIdentity: 'copy-history',
								objectUrl: copyObjectUrl,
								remoteId: 'copy-1',
								verifiedAt: '2026-07-10T00:00:00.000Z'
							}
						],
						count: 1,
						sampleLimit: 10
					}
				}
			],
			filters: { archiveUrlIdentity: null, objectType: null },
			hasMore: false,
			limit: 10,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 1
		},
		roots: [
			{
				archiveUrl: 'https://archive.example/history',
				archiveUrlIdentity: 'history-root',
				checkpoints: {
					mismatchedCheckpoints: 0,
					notEvaluableCheckpoints: 0,
					pendingCheckpoints: 0,
					totalCheckpoints: 1,
					verifiedCheckpoints: 1
				},
				nodePublicKeys: ['GNODE'],
				latestObjectAt: '2026-07-10T00:00:00.000Z',
				objects: {
					activeObjects: 0,
					bucketObjects: 0,
					pendingObjects: 1,
					remoteFailureObjects: 1,
					totalObjects: 1,
					verifiedBucketObjects: 0,
					verifiedObjects: 0,
					workerIssueObjects: 0
				},
				scannerOwnedState: null
			}
		],
		totals: {
			archiveRoots: 1,
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 1,
				verifiedCheckpoints: 1
			},
			nodes: 1,
			objects: {
				activeObjects: 0,
				bucketObjects: 0,
				pendingObjects: 1,
				remoteFailureObjects: 1,
				totalObjects: 1,
				verifiedBucketObjects: 0,
				verifiedObjects: 0,
				workerIssueObjects: 0
			}
		},
		workerIssues: {
			filters: { archiveUrlIdentity: null, objectType: null },
			hasMore: false,
			issues: [],
			limit: 10,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		}
	};
}

function createObject(
	overrides: Partial<PublicHistoryArchiveObject> = {}
): PublicHistoryArchiveObject {
	return {
		archiveUrl: 'https://archive.example/history',
		archiveUrlIdentity: 'history-root',
		attempts: 1,
		bucketHash: null,
		bytesDownloaded: null,
		checkpointLedger: 63,
		delayReason: null,
		error: null,
		nextAttemptAt: null,
		objectKey: 'ledger/0000003f.xdr.gz',
		objectType: 'ledger',
		objectUrl: 'https://archive.example/history/ledger/0000003f.xdr.gz',
		refreshAfter: null,
		remoteId: 'object-1',
		status: 'failed',
		updatedAt: '2026-07-10T00:00:00.000Z',
		claimedAt: null,
		verificationFacts: null,
		verifiedAt: null,
		workerStage: null,
		...overrides
	};
}

function createEvent(object: PublicHistoryArchiveObject) {
	return {
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		bucketHash: object.bucketHash,
		bytesDownloaded: object.bytesDownloaded,
		checkpointLedger: object.checkpointLedger,
		claimAttempt: object.attempts,
		createdAt: object.updatedAt,
		error: object.error,
		eventType: 'failed' as const,
		evidenceClass: 'archive-object' as const,
		nextAttemptAt: object.nextAttemptAt,
		objectKey: object.objectKey,
		objectRemoteId: object.remoteId,
		objectType: object.objectType,
		objectUrl: object.objectUrl,
		remoteId: 'event-1',
		verificationFacts: object.verificationFacts,
		workerStage: object.workerStage
	};
}

function createArchiveState() {
	const archiveUrl = 'https://archive.example/history';
	return {
		archiveUrl,
		archiveUrlIdentity: 'history-root',
		failure: null,
		latestFailure: {
			httpStatus: 503,
			message: 'Remote state refresh returned HTTP 503',
			observedAt: '2026-07-10T00:05:00.000Z',
			source: 'network-scan' as const,
			type: 'http-status'
		},
		metadata: {
			observedAt: '2026-07-10T00:00:00.000Z',
			stellarHistory: {
				currentBuckets: [],
				currentLedger: 63_378_495,
				server: 'stellar-core 23.0.0',
				version: 1
			},
			stellarHistoryUrl: `${archiveUrl}/.well-known/stellar-history.json`
		},
		observedAt: '2026-07-10T00:00:00.000Z',
		source: 'network-scan' as const,
		stateUrl: `${archiveUrl}/.well-known/stellar-history.json`,
		status: 'available' as const
	};
}
