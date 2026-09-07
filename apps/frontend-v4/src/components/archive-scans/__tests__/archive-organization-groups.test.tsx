import { renderToStaticMarkup } from 'react-dom/server';
import {
	groupAdvertisers,
	type ArchiveInventorySort
} from '../archive-inventory-model';
import {
	archiveGroupPage,
	groupArchiveSources
} from '../archive-organization-groups';
import { ArchiveOrganizationGroupHeading } from '../archive-organization-group-heading';
import { ArchiveRootRow } from '../archive-root-row';
import { advertiser, archiveSource } from './archive-organization-fixtures';

const names = new Map([
	['a', 'Alpha'],
	['b', 'Beta']
]);
const small = archiveSource('https://a.example/small', 1, 1);
const large = archiveSource('https://a.example/large', 0, 99);
const beta = archiveSource('https://b.example', 2, 10);
const nodes = [
	advertiser(small.archiveUrl, 'a'),
	advertiser(large.archiveUrl, 'a'),
	advertiser(beta.archiveUrl, 'b')
];
const context = (sortMode: ArchiveInventorySort = 'coverage-desc') => ({
	advertisers: groupAdvertisers(nodes),
	organizationNames: names,
	sortMode
});

describe('organization archive hierarchy', () => {
	it('sorts weighted verified coverage, not average root percentages or input order', () => {
		const roots = [small, large, beta];
		const groups = groupArchiveSources(roots, context());
		expect(groups.map((group) => [group.name, group.verifiedPercent])).toEqual([
			['Beta', 20],
			['Alpha', 1]
		]);
		expect(groups[1]).toMatchObject({
			verifiedPositions: 1,
			expectedPositions: 100
		});
		expect(groupArchiveSources(roots.toReversed(), context())).toEqual(groups);
		expect(
			groupArchiveSources(roots, context('coverage-asc')).map(
				(group) => group.name
			)
		).toEqual(['Alpha', 'Beta']);
		expect(roots).toEqual([small, large, beta]);
	});

	it('puts shared roots in one explicit joint group without duplicate coverage or lost advertiser attribution', () => {
		const shared = archiveSource('https://shared.example/History', 8, 10);
		const advertisers = groupAdvertisers([
			...nodes,
			advertiser(shared.archiveUrl, 'b', 'Beta validator'),
			advertiser(shared.archiveUrl + '/', 'a', 'Alpha validator')
		]);
		const groups = groupArchiveSources(
			[
				shared,
				small,
				beta,
				{ ...shared, archiveUrlIdentity: shared.archiveUrl + '/' }
			],
			{ ...context(), advertisers }
		);
		const joint = groups.find((group) => group.shared)!;
		expect(joint).toMatchObject({
			name: 'Shared by Alpha · Beta',
			verifiedPositions: 8,
			expectedPositions: 10
		});
		expect(groups.flatMap((group) => group.sources)).toHaveLength(3);
		expect(
			groups.reduce((total, group) => total + group.verifiedPositions, 0)
		).toBe(11);
		const html = renderToStaticMarkup(
			<table>
				<tbody role="rowgroup" aria-labelledby="shared-heading">
					<ArchiveOrganizationGroupHeading group={joint} id="shared-heading" />
					<ArchiveRootRow
						source={shared}
						advertisers={advertisers.get(shared.archiveUrl)!}
						canonicalArchiveUrlIdentity={null}
						organizationNames={names}
					/>
				</tbody>
			</table>
		);
		expect(html).toContain('scope="rowgroup"');
		expect(html).toContain('colSpan="4"');
		expect(html).toContain('shared roots listed once');
		expect(html).toContain('Alpha validator');
		expect(html).toContain('Beta validator');
		expect(html).toContain('80.00% verified');
		expect(html).toContain('8 / 10 root-checkpoint positions');
		expect(html).toContain('flex-wrap:wrap');
	});

	it('retains path case and selects the latest whole duplicate snapshot without merging counts', () => {
		const upper = archiveSource('https://a.example/History', 4, 10);
		const lower = archiveSource('https://a.example/history', 7, 10);
		const stale = {
			...upper,
			durableVerifiedCheckpointProofs: 9,
			observedAt: '2026-09-06T12:00:00Z'
		};
		const groups = groupArchiveSources([stale, lower, upper], context());
		expect(groups[0]!.sources).toHaveLength(2);
		expect(groups[0]!.verifiedPositions).toBe(11);
	});

	it('keeps unknown denominators unknown and separates unaffiliated from unadvertised roots', () => {
		const unknown = archiveSource('https://unknown.example', 0, null);
		const unaffiliated = archiveSource('https://listener.example', 4, 10);
		const groups = groupArchiveSources([unknown, unaffiliated, beta], {
			...context(),
			advertisers: groupAdvertisers([
				...nodes,
				advertiser(unaffiliated.archiveUrl, null)
			])
		});
		expect(groups.map((group) => group.name)).toEqual([
			'Unaffiliated validators and listeners',
			'Beta',
			'No current advertiser'
		]);
		expect(groups[2]!.verifiedPercent).toBeNull();
		const html = renderToStaticMarkup(
			<table>
				<tbody>
					<ArchiveOrganizationGroupHeading group={groups[2]!} id="unknown" />
				</tbody>
			</table>
		);
		expect(html).toContain('Verified coverage unknown');
		expect(html).not.toContain('0.00%');
	});

	it('preserves alternate sortable group metrics and never treats scanned positions as verified', () => {
		const scanned = {
			...large,
			scanCoverage: {
				checkedCheckpointPositions: 99,
				listingCoveredCheckpointPositions: 0,
				scannedCheckpointPositions: 99,
				status: 'complete' as const,
				updatedAt: null
			}
		};
		expect(
			groupArchiveSources(
				[small, scanned, beta],
				context('scan-coverage-desc')
			)[0]!.name
		).toBe('Alpha');
		expect(
			groupArchiveSources([small, scanned, beta], context())[0]!.name
		).toBe('Beta');
		const failed = {
			...small,
			archiveEvidenceFailures: 5,
			failureSummary: {
				status: 'current',
				remoteFailureCount: 5,
				archiveFaultCount: 5,
				groups: []
			} as ArchiveSource['failureSummary']
		};
		expect(
			groupArchiveSources([failed, beta], context('failures'))[0]!
				.remoteFailures
		).toBe(5);
		expect(
			groupArchiveSources([small, beta], context('organization-desc'))[0]!.name
		).toBe('Beta');
	});

	it('paginates whole groups and exposes every root, including groups larger than the old row limit', () => {
		const sources = Array.from({ length: 25 }, (_, index) =>
			archiveSource(`https://a.example/${index}`)
		);
		const extra = Array.from({ length: 7 }, (_, index) =>
			archiveSource(`https://extra.example/${index}`)
		);
		const advertisers = groupAdvertisers([
			...sources.map((source) => advertiser(source.archiveUrl, 'a')),
			...extra.map((source, index) =>
				advertiser(source.archiveUrl, `extra-${index}`)
			)
		]);
		const groups = groupArchiveSources([...sources, ...extra], {
			...context('organization'),
			advertisers
		});
		const first = archiveGroupPage(groups, 0);
		const second = archiveGroupPage(groups, 1);
		expect(first.visible[0]!.sources).toHaveLength(25);
		expect(first.hasNext).toBe(true);
		expect(second.hasNext).toBe(false);
		expect(first.visibleRootCount + second.visibleRootCount).toBe(32);
		expect(
			new Set(
				[...first.visible, ...second.visible].flatMap((group) =>
					group.sources.map((source) => source.archiveUrlIdentity)
				)
			).size
		).toBe(32);
		expect(archiveGroupPage(groups, 99).currentPage).toBe(1);
		expect(archiveGroupPage([], 1)).toMatchObject({
			currentPage: 0,
			hasNext: false,
			rootCount: 0
		});
	});
});
