import express from 'express';
import request from 'supertest';
import { mockDeep } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';
import { knownNetworkRouter } from '../KnownNetworkRouter.js';
import type { KnownNetworkRouterConfig } from '../KnownNetworkRouter.js';
import type {
	KnownArchiveEvidenceV1,
	KnownNodeArchiveEvidenceV1,
	KnownOrganizationArchiveEvidenceV1
} from 'shared';
import { InvalidArchiveEvidenceCursorError } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/ArchiveEvidencePagination.js';

describe('KnownNetworkRouter.integration', () => {
	it('exposes paginated scanner-owned archive evidence for a known node', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNodeArchiveEvidence.execute.mockResolvedValue(
			ok(createNodeArchiveEvidence())
		);
		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get(
				'/known/nodes/GNODE/archive-evidence?objectLimit=5&objectStatus=failed&eventLimit=7'
			)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10, stale-while-revalidate=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					publicKey: 'GNODE',
					objectPage: { page: { limit: 5 } },
					eventPage: { page: { limit: 7 } }
				});
			});

		expect(config.getKnownNodeArchiveEvidence.execute).toHaveBeenCalledWith(
			'GNODE',
			expect.objectContaining({
				eventLimit: 7,
				objectLimit: 5,
				objectStatus: 'failed'
			})
		);
	});

	it('exposes aggregate archive evidence for every known organization root', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownOrganizationArchiveEvidence.execute.mockResolvedValue(
			ok(createOrganizationArchiveEvidence())
		);
		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/organizations/org-id/archive-evidence?failureLimit=9')
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					organizationId: 'org-id',
					remoteFailures: { limit: 9 },
					totals: { archiveRoots: 0 }
				});
			});
	});

	it('rejects invalid page options before querying archive evidence', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/nodes/GNODE/archive-evidence?objectLimit=251')
			.expect(400)
			.expect({
				error: {
					code: 'invalid_request',
					message: 'Invalid archive evidence query'
				}
			});
		expect(config.getKnownNodeArchiveEvidence.execute).not.toHaveBeenCalled();
	});

	it('maps invalid archive evidence cursors to client errors', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNodeArchiveEvidence.execute.mockResolvedValue(
			err(new InvalidArchiveEvidenceCursorError())
		);
		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/nodes/GNODE/archive-evidence?objectCursor=invalid')
			.expect(400)
			.expect({
				error: {
					code: 'invalid_request',
					message: 'Invalid archive evidence query'
				}
			});
	});

	it('exposes a known node by public key', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		const node = createDummyNodeV1();
		config.getKnownNode.execute.mockResolvedValue(
			ok({
				publicKey: node.publicKey,
				dateDiscovered: '2020-01-01T00:00:00.000Z',
				node,
				metadataState: 'snapshot',
				current: true,
				scope: 'current-validator',
				snapshotStartDate: '2020-01-01T00:00:00.000Z',
				snapshotEndDate: null,
				lastSeen: '2020-01-01T00:00:00.000Z',
				lastMeasurementAt: '2020-01-01T00:00:00.000Z'
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get(`/known/nodes/${node.publicKey}`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.publicKey).toBe(node.publicKey);
				expect(response.body.node.publicKey).toBe(node.publicKey);
			});
	});

	it('exposes all-known nodes', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNodes.execute.mockResolvedValue(
			ok({
				generatedAt: '2020-01-01T00:00:00.000Z',
				count: 0,
				nodes: [],
				page: { hasMore: false, limit: 25, offset: 50, total: 0 },
				scope: 'archived',
				scopeTotals: {
					'all-known': 0,
					archived: 0,
					'current-validator': 0,
					listener: 0,
					'public-key-only': 0
				},
				source: 'postgres_canonical'
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/nodes?scope=archived&limit=25&offset=50')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.scope).toBe('archived');
				expect(response.body.page).toEqual({
					hasMore: false,
					limit: 25,
					offset: 50,
					total: 0
				});
			});
		expect(config.getKnownNodes.execute).toHaveBeenCalledWith({
			limit: 25,
			offset: 50,
			query: '',
			scope: 'archived'
		});
	});

	it('returns not found for missing known nodes', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNode.execute.mockResolvedValue(ok(null));

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/nodes/not-a-known-node')
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Known node not found' });
			});
	});

	it('exposes a known organization by id', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		const organization = createDummyOrganizationV1();
		config.getKnownOrganization.execute.mockResolvedValue(
			ok({
				organization,
				current: true,
				scope: 'current',
				snapshotStartDate: '2020-01-01T00:00:00.000Z',
				snapshotEndDate: null,
				lastSeen: '2020-01-01T00:00:00.000Z',
				lastMeasurementAt: '2020-01-01T00:00:00.000Z'
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get(`/known/organizations/${organization.id}`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.organization.id).toBe(organization.id);
			});
	});

	it('exposes all-known organizations', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownOrganizations.execute.mockResolvedValue(
			ok({
				generatedAt: '2020-01-01T00:00:00.000Z',
				count: 0,
				organizations: [],
				page: { hasMore: false, limit: 100, offset: 0, total: 0 },
				scope: 'all-known',
				scopeTotals: { 'all-known': 0, archived: 0, current: 0 },
				source: 'postgres_canonical'
			})
		);

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/organizations')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=30')
			.expect((response) => {
				expect(response.body.scope).toBe('all-known');
				expect(response.body.source).toBe('postgres_canonical');
			});
	});

	it.each([
		'/known/nodes?scope=current',
		'/known/nodes?scope=archived&scope=all-known',
		'/known/nodes?limit=501',
		'/known/nodes?offset=-1',
		'/known/organizations?scope=listener',
		'/known/organizations?limit=0'
	])('rejects invalid known-inventory query %s', async (path) => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app).get(path).expect(400);
		expect(config.getKnownNodes.execute).not.toHaveBeenCalled();
		expect(config.getKnownOrganizations.execute).not.toHaveBeenCalled();
	});

	it('returns not found for missing known organizations', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownOrganization.execute.mockResolvedValue(ok(null));

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app)
			.get('/known/organizations/missing')
			.expect(404)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Known organization not found'
				});
			});
	});

	it('maps use-case failures to server errors', async () => {
		const config = mockDeep<KnownNetworkRouterConfig>();
		config.getKnownNodes.execute.mockResolvedValue(err(new Error('failed')));

		const app = express();
		app.use('/known', knownNetworkRouter(config));

		await request(app).get('/known/nodes').expect(500);
	});
});

function createNodeArchiveEvidence(): KnownNodeArchiveEvidenceV1 {
	return {
		...createArchiveEvidence(),
		organizationId: null,
		publicKey: 'GNODE'
	};
}

function createOrganizationArchiveEvidence(): KnownOrganizationArchiveEvidenceV1 {
	return {
		...createArchiveEvidence(),
		organizationId: 'org-id'
	};
}

function createArchiveEvidence(): KnownArchiveEvidenceV1 {
	return {
		eventPage: {
			events: [],
			filters: {
				archiveUrlIdentity: null,
				evidenceClass: null,
				eventType: null,
				objectType: null
			},
			page: {
				hasMore: false,
				limit: 7,
				nextCursor: null,
				snapshotAt: '2026-07-10T00:00:00.000Z',
				total: 0
			}
		},
		generatedAt: '2026-07-10T00:00:00.000Z',
		nodePublicKeys: [],
		objectPage: {
			filters: {
				archiveUrlIdentity: null,
				objectType: null,
				status: 'failed'
			},
			objects: [],
			page: {
				hasMore: false,
				limit: 5,
				nextCursor: null,
				snapshotAt: '2026-07-10T00:00:00.000Z',
				total: 0
			}
		},
		remoteFailures: {
			failures: [],
			filters: { archiveUrlIdentity: null, objectType: null },
			hasMore: false,
			limit: 9,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		},
		roots: [],
		totals: {
			archiveRoots: 0,
			checkpoints: {
				mismatchedCheckpoints: 0,
				notEvaluableCheckpoints: 0,
				pendingCheckpoints: 0,
				totalCheckpoints: 0,
				verifiedCheckpoints: 0
			},
			nodes: 0,
			objects: {
				activeObjects: 0,
				bucketObjects: 0,
				pendingObjects: 0,
				remoteFailureObjects: 0,
				totalObjects: 0,
				verifiedBucketObjects: 0,
				verifiedObjects: 0,
				workerIssueObjects: 0
			}
		},
		workerIssues: {
			filters: { archiveUrlIdentity: null, objectType: null },
			hasMore: false,
			issues: [],
			limit: 25,
			nextCursor: null,
			snapshotAt: '2026-07-10T00:00:00.000Z',
			total: 0
		}
	};
}
