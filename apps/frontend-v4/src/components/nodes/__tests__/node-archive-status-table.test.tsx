/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicSearchResponse } from '../../../api/search-types';
import { NodeArchiveStatusTable } from '../node-archive-status-table';

describe('NodeArchiveStatusTable', () => {
	it('renders a bookmarkable aggregate issue view with evidence links', () => {
		const html = renderToStaticMarkup(
			<NodeArchiveStatusTable
				archiveStatus="issue"
				query="validator"
				response={response()}
			/>
		);

		expect(html).toContain('Archive issues');
		expect(html).toContain('No current archive issue');
		expect(html).toContain('unreachable');
		expect(html).toContain('/nodes/GA_UNREACHABLE#archive-evidence');
		expect(html).toContain('1-1 of 2');
		expect(html).toContain(
			'/nodes?archiveStatus=issue&amp;q=validator&amp;page=2'
		);
		expect(html).toContain(
			'Archive issues include confirmed remote archive errors and currently unreachable roots. Scanner infrastructure issues stay separate.'
		);
	});
});

function response(): PublicSearchResponse {
	return {
		estimatedTotalHits: 2,
		facets: {
			active: [],
			archiveStatus: [
				{ count: 1, value: 'error' },
				{ count: 1, value: 'unreachable' }
			],
			countryCode: [],
			entityType: [{ count: 2, value: 'node' }],
			fullValidator: [],
			scope: [{ count: 2, value: 'current-validator' }],
			topTier: [],
			validating: [],
			validator: [{ count: 2, value: 'true' }]
		},
		hits: [
			{
				archiveStatus: 'unreachable',
				detail: 'validator.example',
				entityId: 'GA_UNREACHABLE',
				entityType: 'node',
				freshness: 'fresh',
				href: '/nodes/GA_UNREACHABLE',
				id: 'node_GA_UNREACHABLE',
				label: 'Unreachable validator',
				observedAt: '2026-08-16T04:00:00.000Z',
				organizationName: 'Example Org',
				recordState: 'current',
				scope: 'current-validator',
				source: 'postgres_canonical'
			}
		],
		indexedNetworkTime: '2026-08-16T04:00:00.000Z',
		pagination: {
			hasMore: true,
			limit: 1,
			offset: 0,
			total: 2,
			totalIsExact: true
		},
		query: 'validator',
		readModel: {
			canonicalCursor: 'cursor',
			fallbackReason: 'meilisearch_unconfigured',
			freshness: 'fresh',
			observedAt: '2026-08-16T04:00:00.000Z',
			schemaVersion: 'v3',
			source: 'postgres_canonical'
		},
		scope: 'current-validator',
		source: 'postgres_canonical'
	};
}
