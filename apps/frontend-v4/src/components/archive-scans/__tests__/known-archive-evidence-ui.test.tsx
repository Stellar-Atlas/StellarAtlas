/// <reference types="jest" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
	PublicHistoryArchiveObject,
	PublicKnownNodeArchiveEvidence
} from '../../../api/archive-evidence-types';
import { getArchiveScanDetailPath } from '../../../domain/archive-scan-routes';
import { KnownArchiveEvidence } from '../known-archive-evidence';
import { KnownArchiveListingGaps } from '../known-archive-listing-gaps';
import { ArchiveSourceFilter } from '../known-archive-evidence-controls';
import { getInitialRepairArchiveUrl } from '../known-archive-evidence-state';
import {
	ArchiveActivityTable,
	ArchiveRootSummaryTable,
	RemoteFailureTable
} from '../known-archive-evidence-tables';
import {
	ObjectIdentity,
	ObjectSource,
	formatEventType,
	formatObjectStatusDetail
} from '../known-archive-evidence-table-parts';
describe('known archive evidence UI', () => {
	it.each(['not_requested', 'unavailable'] as const)(
		'does not describe unknown copies as absent when %s',
		(lookupStatus) => {
			const evidence = createEvidence();
			const set = { count: null, copies: [], lookupStatus, sampleLimit: 0 };
			const markup = renderToStaticMarkup(
				createElement(RemoteFailureTable, {
					page: {
						...evidence.remoteFailures,
						failures: evidence.remoteFailures.failures.map((failure) => ({
							...failure,
							object: {
								...failure.object,
								error: {
									type: 'archive_http_error',
									httpStatus: 404,
									message: 'missing source file'
								}
							},
							networkVerifiedCopies: set,
							sameOrganizationVerifiedCopies: set
						}))
					}
				})
			);
			expect(markup).toContain(
				lookupStatus === 'not_requested'
					? 'Replacement copies: check the Repair view'
					: 'Replacement copy lookup temporarily unavailable'
			);
			expect(markup).not.toContain('No verified alternate copy found');
			expect(markup).toContain('404');
		}
	);
	it('renders listing gaps separately from GET failures with exact source, observation and alternate proof provenance', () => {
		const evidence = createEvidence();
		const original = evidence.roots[0];
		if (original === undefined) throw new Error('Expected fixture root');
		const gap = {
			kind: 'directory-listing-gap' as const,
			firstCheckpointLedger: 127,
			lastCheckpointLedger: 255,
			resumeCheckpointLedger: 319,
			checkpointCount: 3,
			observedAt: '2026-09-06T23:00:00Z',
			sourceCheckpointProofId: '9007199254740993',
			sourceArchiveUrlIdentity: 'https://other.example/Case',
			listings: (['history', 'ledger', 'transactions', 'results'] as const).map(
				(category) => ({
					category,
					listingUrl: `https://archive.example/Case/${category}/00/00/00/`,
					responseSha256: 'a'.repeat(64),
					firstReturnedKey: null,
					firstReturnedCheckpoint: null,
					completePrefix: `Case/${category}/00/00/00/`,
					rangeThroughCheckpoint: 255
				})
			)
		};
		const roots = [
			{
				...original,
				archiveUrl: 'https://archive.example/Case',
				archiveUrlIdentity: 'https://archive.example/Case',
				listingGapCount: 1,
				listingGaps: [gap]
			}
		];
		const html = renderToStaticMarkup(
			createElement(KnownArchiveListingGaps, {
				roots,
				archiveUrl: null,
				objectType: null
			})
		);
		expect(html).toContain('127–255: 3 checkpoints with missing files');
		expect(html).toContain('archive.example/Case');
		expect(html).toContain('dateTime="2026-09-06T23:00:00.000Z"');
		expect(html).toContain('9007199254740993');
		expect(html).toContain('other.example/Case');
		expect(html).toContain('not individual HTTP failures');
		expect(html).toContain('bucket contents are not covered');
		expect(html).toContain('complete directory listing through checkpoint 255');
		expect(html).not.toContain('first returned checkpoint 0');
		expect(
			renderToStaticMarkup(
				createElement(KnownArchiveListingGaps, {
					roots,
					archiveUrl: 'https://archive.example/case',
					objectType: null
				})
			)
		).toBe('');
		expect(
			renderToStaticMarkup(
				createElement(KnownArchiveListingGaps, {
					roots,
					archiveUrl: null,
					objectType: 'bucket'
				})
			)
		).toBe('');
	});
	it('uses the shared local timestamp for the archive source health update', () => {
		const timestamp = '2026-09-06T04:31:00.000Z';
		const markup = renderToStaticMarkup(
			createElement(KnownArchiveEvidence, {
				evidence: { ...createEvidence(), generatedAt: timestamp },
				subject: {
					id: 'https://core-live-c-history.lightsail.network',
					kind: 'archive'
				},
				title: 'Archive source health'
			})
		);

		expect(markup).toContain(
			'Updated <time dateTime="2026-09-06T04:31:00.000Z" title="2026-09-06T04:31:00.000Z">2026-09-06 04:31 UTC</time>'
		);
		expect(markup).not.toContain('Updated Sep 6, 2026, 4:31 AM');
	});

	it('keeps raw evidence secondary to the accessible operational tabs', () => {
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
		expect(markup.match(/role="tab"/g)).toHaveLength(6);
		expect(markup).not.toContain('>Raw response</button>');
		expect(markup).toContain('Raw initial API response');
		expect(markup).not.toContain('&quot;generatedAt&quot;');
		expect(markup).toContain('1 archive source across 1 node');
	});

	it('separates a failed source from API-proven alternate copies', () => {
		const markup = renderToStaticMarkup(
			createElement(RemoteFailureTable, {
				page: createEvidence().remoteFailures
			})
		);

		expect(markup).toContain('Archive file');
		expect(markup).toContain('Source evidence');
		expect(markup).toContain('Checked source');
		expect(markup).toContain('2 verified alternate copies');
		expect(markup).toContain(
			'<details class="verified-alternate-copies"><summary>'
		);
		expect(markup).not.toContain(
			'<details open="" class="verified-alternate-copies">'
		);
		expect(markup).toContain(
			'Verified <time dateTime="2026-07-10T00:00:00.000Z" title="2026-07-10T00:00:00.000Z">2026-07-10 00:00 UTC</time>'
		);
		expect(markup).toContain('Retry once');
		expect(markup).toContain('Same organization (1)');
		expect(markup).toContain('Other network source (1)');
		expect(markup).toContain(
			'href="https://copy.example/history/ledger/0000003f.xdr.gz"'
		);
		expect(markup).toContain(
			'href="https://network-copy.example/ledger/0000003f.xdr.gz"'
		);
	});

	it('selects a sole repair source without coupling it to failure filters', () => {
		const evidence = createEvidence();
		const root = evidence.roots[0];
		if (root === undefined) throw new Error('Expected an archive root');

		expect(getInitialRepairArchiveUrl(evidence)).toBe(
			'https://archive.example/history'
		);
		expect(
			getInitialRepairArchiveUrl({
				...evidence,
				roots: [...evidence.roots, { ...root }]
			})
		).toBeNull();
		expect(getInitialRepairArchiveUrl({ ...evidence, roots: [] })).toBeNull();
	});

	it('labels an unselected repair source as a required selection', () => {
		const evidence = createEvidence();
		const markup = renderToStaticMarkup(
			createElement(ArchiveSourceFilter, {
				disabled: false,
				emptyLabel: 'Select a source',
				onChange: () => undefined,
				roots: evidence.roots,
				value: null
			})
		);

		expect(markup).toContain('Select a source');
		expect(markup).toContain('archive.example/history - 1 node');
		expect(markup).not.toContain('All sources');
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

	it('maps planning-deferred delay reasons to operator-facing copy', () => {
		expect(
			formatObjectStatusDetail(
				createObject({
					delayReason: { code: 'planning-deferred', until: null }
				})
			)
		).toBe('Queued for verification');
	});

	it('labels category files by checkpoint without repeating the file type', () => {
		const markup = renderToStaticMarkup(
			createElement(ObjectIdentity, {
				object: createObject({ checkpointLedger: 63, objectType: 'ledger' })
			})
		);

		expect(markup).toContain('<strong>Ledger</strong>');
		expect(markup).toContain('Checkpoint 63');
		expect(markup).not.toContain('Ledger 63');
	});

	it('does not repeat a terminal status as worker-stage detail', () => {
		expect(
			formatObjectStatusDetail(
				createObject({ status: 'verified', workerStage: 'verified' })
			)
		).toBeNull();
	});

	it('describes migrated deferred rows without legacy implementation language', () => {
		const detail = formatObjectStatusDetail(
			createObject({
				delayReason: { code: 'legacy-deferred', until: null }
			})
		);

		expect(detail).toBe('Queued for verification');
		expect(detail).not.toContain('legacy');
	});

	it('explains scheduler capacity and retry delays without internal codes', () => {
		expect(
			formatObjectStatusDetail(
				createObject({
					delayReason: { code: 'global-active-cap', until: null }
				})
			)
		).toBe('Waiting for a scanner slot');
		expect(
			formatObjectStatusDetail(
				createObject({
					delayReason: {
						code: 'retry-window',
						until: '2026-07-10T00:10:00.000Z'
					}
				})
			)
		).toContain('Retry scheduled until');
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

	it('labels an older failure as historical after a successful refresh', () => {
		const evidence = createEvidence();
		const root = evidence.roots[0];
		if (root === undefined) throw new Error('Expected archive root');
		const state = createArchiveState();
		const markup = renderToStaticMarkup(
			createElement(ArchiveRootSummaryTable, {
				roots: [
					{
						...root,
						scannerOwnedState: {
							...state,
							observedAt: '2026-07-10T00:10:00.000Z',
							metadata: state.metadata && {
								...state.metadata,
								observedAt: '2026-07-10T00:10:00.000Z'
							}
						}
					}
				]
			})
		);

		expect(markup).toContain('Previous refresh failure');
		expect(markup).not.toContain('Latest refresh failed');
	});

	it('does not invent ordering for observations with the same timestamp', () => {
		const evidence = createEvidence();
		const root = evidence.roots[0];
		if (root === undefined) throw new Error('Expected archive root');
		const state = createArchiveState();
		const failureObservedAt = state.latestFailure?.observedAt;
		if (failureObservedAt === undefined) {
			throw new Error('Expected retained failure evidence');
		}
		const markup = renderToStaticMarkup(
			createElement(ArchiveRootSummaryTable, {
				roots: [
					{
						...root,
						scannerOwnedState: {
							...state,
							observedAt: failureObservedAt,
							metadata: state.metadata && {
								...state.metadata,
								observedAt: failureObservedAt
							}
						}
					}
				]
			})
		);

		expect(markup).toContain(
			'Refresh failure at stored-state observation time'
		);
		expect(markup).not.toContain('Latest refresh failed');
		expect(markup).not.toContain('Previous refresh failure');
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

		expect(detail).toContain('Archive source temporarily paused until');
		expect(detail).toContain('2026');
	});

	it('renders machine event codes as readable labels', () => {
		expect(formatEventType('download_started')).toBe('Download started');
		expect(formatEventType('proof-refresh-failed')).toBe(
			'Proof refresh failed'
		);
	});
});

function createEvidence(): PublicKnownNodeArchiveEvidence {
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
						copies: [
							{
								archiveUrl: 'https://network-copy.example',
								archiveUrlIdentity: 'network-copy',
								objectUrl:
									'https://network-copy.example/ledger/0000003f.xdr.gz',
								remoteId: 'network-copy-1',
								verifiedAt: '2026-07-10T00:00:00.000Z'
							}
						],
						count: 1,
						sampleLimit: 10
					},
					object,
					sameOrganizationVerifiedCopies: {
						copies: [
							{
								archiveUrl: 'https://copy.example/history',
								archiveUrlIdentity: 'copy-history',
								objectUrl:
									'https://copy.example/history/ledger/0000003f.xdr.gz',
								remoteId: 'organization-copy-1',
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
				scannerOwnedState: null,
				sequentialCoverage: {
					advertisedLatestCheckpointLedger: 127,
					blockedCheckpointLedger: null,
					blocker: null,
					lastContinuouslyVerifiedCheckpointLedger: 63,
					nextCheckpointLedger: 127,
					status: 'advancing' as const
				}
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
