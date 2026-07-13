/// <reference types="jest" />

import { buildArchiveEvidencePath } from '../known-archive-evidence-query';
import {
	buildKnownNodesPath,
	buildKnownOrganizationsPath
} from '../known-network-query';

describe('known archive evidence client', () => {
	it('serializes every typed page and filter option', () => {
		const path = buildArchiveEvidencePath(
			'/v1/known/nodes/GNODE/archive-evidence',
			{
				archiveUrl: 'https://archive.example/history',
				copyLimit: 10,
				eventCursor: 'event-cursor',
				eventEvidenceClass: 'worker-infrastructure',
				eventLimit: 8,
				eventObjectType: 'scp',
				eventType: 'failed',
				failureCursor: 'failure-cursor',
				failureLimit: 9,
				failureObjectType: 'bucket',
				objectCursor: 'object-cursor',
				objectLimit: 7,
				objectStatus: 'verified',
				objectType: 'ledger',
				workerIssueCursor: 'worker-cursor',
				workerIssueLimit: 6
			}
		);
		const url = new URL(path, 'https://frontend.example');

		expect(Object.fromEntries(url.searchParams)).toEqual({
			archiveUrl: 'https://archive.example/history',
			copyLimit: '10',
			eventCursor: 'event-cursor',
			eventEvidenceClass: 'worker-infrastructure',
			eventLimit: '8',
			eventObjectType: 'scp',
			eventType: 'failed',
			failureCursor: 'failure-cursor',
			failureLimit: '9',
			failureObjectType: 'bucket',
			objectCursor: 'object-cursor',
			objectLimit: '7',
			objectStatus: 'verified',
			objectType: 'ledger',
			workerIssueCursor: 'worker-cursor',
			workerIssueLimit: '6'
		});
	});

	it('does not add an empty query string', () => {
		expect(
			buildArchiveEvidencePath(
				'/v1/known/organizations/org/archive-evidence',
				{}
			)
		).toBe('/v1/known/organizations/org/archive-evidence');
	});
});

describe('known inventory query', () => {
	it('serializes explicit scopes and pagination', () => {
		expect(
			buildKnownNodesPath({
				limit: 50,
				offset: 100,
				query: 'stellar',
				scope: 'public-key-only'
			})
		).toBe(
			'/v1/known/nodes?scope=public-key-only&q=stellar&limit=50&offset=100'
		);
		expect(buildKnownOrganizationsPath({ limit: 25, scope: 'archived' })).toBe(
			'/v1/known/organizations?scope=archived&limit=25'
		);
	});
});
