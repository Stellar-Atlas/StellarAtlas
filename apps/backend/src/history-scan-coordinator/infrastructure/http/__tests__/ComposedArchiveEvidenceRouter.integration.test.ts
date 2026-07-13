import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { HistoryArchiveEvidenceV2 } from 'shared';
import type { GetHistoryArchiveEvidence } from '../../../use-cases/get-history-archive-evidence/GetHistoryArchiveEvidence.js';
import { archiveEvidenceRouter } from '../ArchiveEvidenceRouter.js';
import { PublicArchiveEvidenceAdmission } from '../PublicArchiveEvidenceRequest.js';

describe('composed archive evidence V2 router', () => {
	it('returns paged evidence with exact cache metadata', async () => {
		const getHistoryArchiveEvidence = mock<GetHistoryArchiveEvidence>();
		getHistoryArchiveEvidence.execute.mockResolvedValue(ok(createEvidence()));
		const app = createApp(getHistoryArchiveEvidence);

		await request(app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/object-evidence?objectLimit=5&eventLimit=7'
			)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10, stale-while-revalidate=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					archiveUrl: 'https://history.example.com',
					eventPage: { page: { snapshotAt, total: 0 } },
					objectPage: { page: { snapshotAt, total: 0 } },
					root: { archiveUrlIdentity: 'https://history.example.com' }
				});
			});

		expect(getHistoryArchiveEvidence.execute).toHaveBeenCalledWith(
			'https://history.example.com',
			expect.objectContaining({ eventLimit: 7, objectLimit: 5 })
		);
	});

	it('accepts zero limits as omitted projections', async () => {
		const getHistoryArchiveEvidence = mock<GetHistoryArchiveEvidence>();
		getHistoryArchiveEvidence.execute.mockResolvedValue(ok(createEvidence()));
		const app = createApp(getHistoryArchiveEvidence);

		await request(app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/object-evidence?eventLimit=0&failureLimit=0&objectLimit=0&workerIssueLimit=0'
			)
			.expect(200);
		expect(getHistoryArchiveEvidence.execute).toHaveBeenCalledWith(
			'https://history.example.com',
			expect.objectContaining({
				eventLimit: 0,
				failureLimit: 0,
				objectLimit: 0,
				workerIssueLimit: 0
			})
		);
	});

	it('uses one normalized 400 error contract', async () => {
		const getHistoryArchiveEvidence = mock<GetHistoryArchiveEvidence>();
		const app = createApp(getHistoryArchiveEvidence);

		await request(app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/object-evidence?objectLimit=-1'
			)
			.expect(400)
			.expect({
				error: {
					code: 'invalid_request',
					message: 'Invalid archive evidence query'
				}
			});
		expect(getHistoryArchiveEvidence.execute).not.toHaveBeenCalled();
	});
});

const snapshotAt = '2026-07-10T12:00:00.000Z';

function createApp(
	getHistoryArchiveEvidence: GetHistoryArchiveEvidence
): express.Application {
	const app = express();
	app.use(
		'/archive-scans',
		archiveEvidenceRouter({
			admission: new PublicArchiveEvidenceAdmission(4, 1_000),
			getHistoryArchiveEvidence
		})
	);
	return app;
}

function createEvidence(): HistoryArchiveEvidenceV2 {
	const page = {
		hasMore: false,
		limit: 25,
		nextCursor: null,
		snapshotAt,
		total: 0
	};
	return {
		archiveUrl: 'https://history.example.com',
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: 'https://history.example.com',
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page
		},
		generatedAt: snapshotAt,
		objectPage: {
			filters: {
				archiveUrlIdentity: 'https://history.example.com',
				objectType: null,
				status: null
			},
			objects: [],
			page
		},
		remoteFailures: {
			failures: [],
			filters: {
				archiveUrlIdentity: 'https://history.example.com',
				objectType: null
			},
			...page
		},
		root: {
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 0,
				verifiedCheckpoints: 0
			},
			latestObjectAt: null,
			nodePublicKeys: [],
			objects: {
				activeObjects: 0,
				bucketObjects: 0,
				pendingObjects: 0,
				remoteFailureObjects: 0,
				totalObjects: 0,
				verifiedBucketObjects: 0,
				verifiedObjects: 0,
				workerIssueObjects: 0
			},
			scannerOwnedState: null
		},
		workerIssues: {
			filters: {
				archiveUrlIdentity: 'https://history.example.com',
				objectType: null
			},
			issues: [],
			...page
		}
	};
}
