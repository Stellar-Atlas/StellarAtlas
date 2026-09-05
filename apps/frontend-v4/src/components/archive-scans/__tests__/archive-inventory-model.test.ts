import type { PublicNode } from '@api/types';
import {
	groupAdvertisers,
	matchesArchiveSource,
	normalizeRoot,
	type ArchiveSource
} from '../archive-inventory-model';

const node = {
	publicKey: 'GVALIDATORKEY',
	name: 'North Validator',
	alias: null,
	historyUrl: 'https://history.example/GAYYW/',
	organizationId: 'org',
	homeDomain: 'example.org',
	isValidator: true
} as PublicNode;
const source = { archiveUrl: 'https://history.example/GAYYW' } as ArchiveSource;
const organizations = new Map([['org', 'Example Foundation']]);

describe('archive inventory search and identity', () => {
	it('matches URL, organization, validator name and key without requests', () => {
		for (const query of [
			'history.example',
			'foundation',
			'north',
			'gvalidatorkey',
			''
		]) {
			expect(matchesArchiveSource(source, query, [node], organizations)).toBe(
				true
			);
		}
		expect(
			matchesArchiveSource(source, 'another root', [node], organizations)
		).toBe(false);
	});

	it('never merges case-sensitive URL paths while matching advertisers', () => {
		expect(normalizeRoot('https://HISTORY.example/GAYYW/')).toBe(
			source.archiveUrl
		);
		expect(normalizeRoot('https://history.example/gayyw')).not.toBe(
			source.archiveUrl
		);
		const grouped = groupAdvertisers([
			node,
			{
				...node,
				publicKey: 'GSECONDKEY',
				historyUrl: 'https://history.example/gayyw'
			}
		]);
		expect(grouped.size).toBe(2);
		expect(grouped.get(source.archiveUrl)?.[0]?.publicKey).toBe(
			'GVALIDATORKEY'
		);
	});

	it('keeps a source without current advertisers searchable by its URL', () => {
		expect(matchesArchiveSource(source, 'gayYw', [], organizations)).toBe(true);
	});
});
