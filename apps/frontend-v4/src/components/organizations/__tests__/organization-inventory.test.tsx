import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicOrganization } from '@api/types';
import type { PublicKnownOrganizationListItem } from '@api/known-network-types';
import {
	organizationInventoryAvailability,
	organizationInventoryTags,
	organizationInventoryHref
} from '../organization-inventory-model';
jest.unstable_mockModule('../organization-inventory.module.css', () => ({
	default: {
		inventory: 'organization-inventory',
		detail: 'organization-detail'
	}
}));
jest.unstable_mockModule('next/navigation', () => ({
	useRouter: () => ({ push: jest.fn() })
}));
const { OrganizationTable } = await import('../organization-table');
const { OrganizationDetail } = await import('../organization-detail');

describe('organization inventory presentation', () => {
	it('preserves measured availability instead of inflating 99.29 percent to 100', () => {
		const org = organization({ subQuorum24HoursAvailability: 99.29 });
		expect(organizationInventoryAvailability(org, 'current', '24h').value).toBe(
			'99.3%'
		);
		expect(
			organizationInventoryAvailability(
				{ ...org, has24HourStats: false },
				'current',
				'24h'
			).value
		).toBe('Collecting');
	});
	it('shows archived measurements neutrally while retaining metadata findings', () => {
		const org = organization({
			subQuorumAvailable: false,
			subQuorum24HoursAvailability: 0,
			subQuorum30DaysAvailability: 0,
			tomlState: 'NotFound'
		});
		const archived = organizationInventoryTags(org, 'archived');
		expect(archived.map((tag) => tag.label)).toEqual([
			'archived',
			'stellar.toml not found'
		]);
		expect(
			organizationInventoryAvailability(org, 'archived', '24h')
		).toMatchObject({
			value: '0.0%',
			tone: 'muted',
			detail: 'Historical measurement'
		});
		expect(
			organizationInventoryTags(org, 'current').map((tag) => tag.label)
		).toContain('quorum path risk');
		expect(
			organizationInventoryAvailability(
				{ ...org, has30DayStats: false },
				'archived',
				'30d'
			).value
		).toBe('Not recorded');
	});
	it('encodes query and scope without treating organization names or addresses as route paths', () => {
		const href = organizationInventoryHref(
			'archived',
			'  Acme & Sons / 100%  ',
			2
		);
		const url = new URL(href, 'https://stellaratlas.io');
		expect(url.pathname).toBe('/organizations');
		expect(url.searchParams.get('q')).toBe('Acme & Sons / 100%');
		expect(url.searchParams.get('scope')).toBe('archived');
		expect(url.searchParams.get('page')).toBe('2');
	});
	it('renders accessible search, full column labels, canonical ID links and historical timestamps', () => {
		const entry = knownOrganization();
		const html = renderToStaticMarkup(
			<OrganizationTable
				organizations={[entry]}
				page={{ hasMore: false, limit: 25, offset: 0, total: 1 }}
				query="example"
				scope="all-known"
				totalCount={24}
			/>
		);
		expect(html).toContain('<form');
		expect(html).toContain('type="submit"');
		expect(html).toContain('>Search</button>');
		expect(html).toContain('value="example"');
		expect(html).toContain('/organizations/org%25id');
		for (const label of [
			'Organization',
			'Validators',
			'24H availability',
			'30D availability',
			'Status'
		])
			expect(html).toContain('data-label="' + label + '"');
		expect(html).toContain('2026-08-09T12:00:00.000Z');
		expect(html).toContain('Historical measurement');
		expect(html).not.toContain('quorum path risk');
	});
	it('shows an explicit empty result without an impossible 26-25 count', () => {
		const html = renderToStaticMarkup(
			<OrganizationTable
				organizations={[]}
				page={{ hasMore: false, limit: 25, offset: 25, total: 0 }}
				query="absent"
				scope="all-known"
				totalCount={24}
			/>
		);
		expect(html).toContain('No organizations match');
		expect(html).toContain('Showing 0-0 of 0');
	});
	it('puts organization status and validators before the full archive evidence', () => {
		const entry = knownOrganization();
		const html = renderToStaticMarkup(
			<OrganizationDetail
				archiveEvidence={
					<section id="archive-evidence">Full archive evidence</section>
				}
				network={{ nodes: [] }}
				organization={entry.organization}
				scope={entry.scope}
				lastMeasurementAt={entry.lastMeasurementAt}
			/>
		);
		expect(html.indexOf('Archived organization record')).toBeLessThan(
			html.indexOf('Full archive evidence')
		);
		expect(html.indexOf('<h2>Validators')).toBeLessThan(
			html.indexOf('Full archive evidence')
		);
		expect(html).toContain('historical snapshot');
		expect(html).toContain('2026-08-09T12:00:00.000Z');
	});
});

function knownOrganization(): PublicKnownOrganizationListItem {
	return {
		current: false,
		lastMeasurementAt: '2026-08-09T12:00:00.000Z',
		lastSeen: '2026-08-09T12:00:00.000Z',
		organization: organization({
			subQuorumAvailable: false,
			subQuorum24HoursAvailability: 0
		}),
		scope: 'archived',
		snapshotEndDate: '2026-08-09T12:00:00.000Z',
		snapshotStartDate: '2026-07-01T00:00:00.000Z'
	};
}
function organization(
	overrides: Partial<PublicOrganization> = {}
): PublicOrganization {
	return {
		dateDiscovered: '2026-07-01T00:00:00.000Z',
		dba: null,
		description: null,
		github: null,
		has24HourStats: true,
		has30DayStats: true,
		hasReliableUptime: true,
		homeDomain: 'example.org',
		horizonUrl: null,
		id: 'org%id',
		keybase: null,
		logo: null,
		name: 'Example Organization',
		officialEmail: null,
		phoneNumber: null,
		physicalAddress: null,
		stellarToml: null,
		subQuorum24HoursAvailability: 100,
		subQuorum30DaysAvailability: 100,
		subQuorumAvailable: true,
		tomlState: 'Ok',
		tomlWarnings: [],
		twitter: null,
		url: null,
		validators: [],
		...overrides
	};
}
