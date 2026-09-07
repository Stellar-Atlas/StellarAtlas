import type { PublicNode } from '@api/types';
import {
	groupAdvertisers,
	hasArchiveSourceFindings,
	compareSources,
	defaultArchiveInventorySort,
	type ArchiveInventorySort,
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
	it('keeps gap-only roots in the failure filter without inventing failed files', () => {
		expect(
			hasArchiveSourceFindings({
				archiveEvidenceFailures: 0,
				mismatchCheckpointProofs: 0,
				listingGapCount: 1
			})
		).toBe(true);
		expect(
			hasArchiveSourceFindings({
				archiveEvidenceFailures: 0,
				mismatchCheckpointProofs: 0
			})
		).toBe(false);
	});
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

describe('archive inventory ordering', () => {
	const root = (url: string, failures = 0, verified = 1): ArchiveSource =>
		({
			archiveUrl: url,
			archiveUrlIdentity: url,
			archiveEvidenceFailures: failures,
			mismatchCheckpointProofs: 0,
			durableVerifiedCheckpointProofs: verified,
			currentLedger: 639,
			latestCheckpointLedger: 639,
			latestDiscoveredCheckpointLedger: 639
		}) as ArchiveSource;
	const alphaTwo = root('https://a.example/second', 7, 2);
	const alphaOne = root('https://z.example/first', 3, 8);
	const alphaOneOtherRoot = root('https://z.example/other', 3, 8);
	const beta = root('https://b.example', 90, 10);
	const listener = root('https://listener.example', 0, 4);
	const unknown = root('https://unknown.example');
	const sources = [
		unknown,
		beta,
		alphaTwo,
		alphaOneOtherRoot,
		listener,
		alphaOne
	];
	const advertisers = groupAdvertisers([
		{
			...node,
			historyUrl: alphaTwo.archiveUrl,
			name: 'Validator 10',
			organizationId: 'alpha'
		},
		{
			...node,
			historyUrl: alphaOne.archiveUrl,
			name: 'Validator 2',
			organizationId: 'alpha'
		},
		{
			...node,
			historyUrl: alphaOneOtherRoot.archiveUrl,
			name: 'Validator 2',
			organizationId: 'alpha'
		},
		{
			...node,
			historyUrl: beta.archiveUrl,
			name: 'Validator 1',
			organizationId: 'beta'
		},
		{
			...node,
			historyUrl: listener.archiveUrl,
			name: 'Listener',
			organizationId: 'beta',
			isValidator: false
		}
	]);
	const organizationNames = new Map([
		['alpha', 'Alpha Organization'],
		['beta', 'Beta Organization']
	]);
	const ordered = (sortMode: ArchiveInventorySort, input = sources) =>
		input.toSorted((left, right) =>
			compareSources(left, right, {
				advertisers,
				organizationNames,
				sortMode
			})
		);

	it('defaults to highest verified percentage with deterministic organization ties', () => {
		expect(defaultArchiveInventorySort).toBe('coverage-desc');
		const expected = [
			beta,
			alphaOne,
			alphaOneOtherRoot,
			listener,
			alphaTwo,
			unknown
		];
		expect(ordered(defaultArchiveInventorySort)).toEqual(expected);
		expect(ordered(defaultArchiveInventorySort, sources.toReversed())).toEqual(
			expected
		);
	});

	it('honors alternate sorts with deterministic ties and no implicit pinned root', () => {
		expect(ordered('failures')[0]).toBe(beta);
		expect(ordered('coverage-desc')[0]).toBe(beta);
		expect(ordered('coverage-asc')[0]).toBe(unknown);
		expect(ordered('url')[0]).toBe(alphaTwo);
		expect(ordered('validator')[0]).toBe(listener);
		for (const [descending, ascending] of [
			['url-desc', 'url'],
			['organization-desc', 'organization'],
			['validator-desc', 'validator'],
			['failures-asc', 'failures']
		] as const) {
			expect(ordered(descending)).toEqual(ordered(ascending).toReversed());
		}
		for (const mode of [
			'failures',
			'coverage-desc',
			'coverage-asc',
			'url',
			'validator'
		] as const) {
			expect(ordered(mode)).toEqual(ordered(mode, sources.toReversed()));
		}
	});

	it('retains case-sensitive roots as distinct rows with stable URL tie breaking', () => {
		const uppercase = root('https://history.example/GAYYW');
		const lowercase = root('https://history.example/gayyw');
		const result = ordered('url', [lowercase, uppercase]);
		expect(result).toHaveLength(2);
		expect(result).toEqual(ordered('url', [uppercase, lowercase]));
		expect(result.map((entry) => entry.archiveUrlIdentity)).toEqual([
			uppercase.archiveUrlIdentity,
			lowercase.archiveUrlIdentity
		]);
	});

	it('does not mutate source order or completed/failed counts while sorting', () => {
		const before = structuredClone(sources);
		ordered('organization');
		expect(sources).toEqual(before);
		expect(
			ordered('failures').reduce(
				(sum, entry) => sum + entry.archiveEvidenceFailures,
				0
			)
		).toBe(
			sources.reduce((sum, entry) => sum + entry.archiveEvidenceFailures, 0)
		);
		expect(
			ordered('coverage-desc').reduce(
				(sum, entry) => sum + entry.durableVerifiedCheckpointProofs,
				0
			)
		).toBe(
			sources.reduce(
				(sum, entry) => sum + entry.durableVerifiedCheckpointProofs,
				0
			)
		);
	});
});
