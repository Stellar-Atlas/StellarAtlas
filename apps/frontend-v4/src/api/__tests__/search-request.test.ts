/// <reference types="jest" />

import { buildNetworkSearchPath } from '../search-request';

describe('network search request', () => {
	it('defaults autocomplete to the paged all-known inventory', () => {
		const url = new URL(
			buildNetworkSearchPath('  validator  ', {}),
			'https://frontend.example'
		);
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			limit: '8',
			offset: '0',
			q: 'validator',
			scope: 'all-known'
		});
	});

	it('serializes explicit scope, pagination, and facets', () => {
		const url = new URL(
			buildNetworkSearchPath('archive', {
				archiveStatus: 'error',
				offset: 16,
				scope: 'archived',
				validator: true
			}),
			'https://frontend.example'
		);
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			archiveStatus: 'error',
			offset: '16',
			scope: 'archived',
			validator: 'true'
		});
	});

	it('serializes organization and archive-root document scopes', () => {
		const organizationUrl = new URL(
			buildNetworkSearchPath('stellar', {
				entityType: 'organization',
				scope: 'current-organization'
			}),
			'https://frontend.example'
		);
		const archiveUrl = new URL(
			buildNetworkSearchPath('history', {
				entityType: 'archive-root',
				scope: 'archive-root'
			}),
			'https://frontend.example'
		);

		expect(organizationUrl.searchParams.get('scope')).toBe(
			'current-organization'
		);
		expect(archiveUrl.searchParams.get('scope')).toBe('archive-root');
	});
});
