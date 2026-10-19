import { describe, expect, test } from '@jest/globals';
import { buildEntityApiPath } from '../../../api/explorer-analytics';
import { explorerRouteFilters } from '../../../api/explorer-search-route';

describe('explorer page-size query handling', () => {
	test('preserves a valid limit and offset in the generated API query', () => {
		const url = new URL(
			buildEntityApiPath('operations', undefined, { limit: '50' }, 50),
			'https://api.stellaratlas.io'
		);

		expect(url.searchParams.get('limit')).toBe('50');
		expect(url.searchParams.get('offset')).toBe('50');
	});

	test('defaults invalid or missing limits to 25', () => {
		for (const limit of ['0', '101', '-1', 'abc']) {
			const url = new URL(
				buildEntityApiPath('assets', undefined, { limit }, 0),
				'https://api.stellaratlas.io'
			);

			expect(url.searchParams.get('limit')).toBe('25');
		}

		const defaultUrl = new URL(
			buildEntityApiPath('assets', undefined, {}, 0),
			'https://api.stellaratlas.io'
		);
		expect(defaultUrl.searchParams.get('limit')).toBe('25');
	});

	test('keeps supported route filters but excludes offset and unknown keys', () => {
		expect(
			explorerRouteFilters({
				limit: '50',
				min_ledger: '100',
				max_ledger: '200',
				type: 'invoke_host_function',
				offset: '50',
				unknown_filter: 'ignored'
			})
		).toEqual({
			limit: '50',
			min_ledger: '100',
			max_ledger: '200',
			type: 'invoke_host_function'
		});
	});
});
