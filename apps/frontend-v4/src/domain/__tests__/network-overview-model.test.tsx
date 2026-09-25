import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
import {
	nodeFixture,
	networkFixture,
	organizationFixture
} from '../../components/nodes/__tests__/node-detail-fixtures';
import {
	getOverviewAttention,
	getOverviewOrganizations,
	getOverviewVersions
} from '../network-overview-model';

jest.unstable_mockModule(
	'../../components/network-overview.module.css',
	() => ({ default: {} })
);
const { NetworkOverview } = await import('../../components/network-overview');

describe('network overview semantics', () => {
	it('counts observed validators without mistaking listed keys or listeners for validating nodes', () => {
		const organization = {
			...organizationFixture('operator'),
			validators: ['one', 'two', 'absent']
		};
		const network = networkFixture(
			[
				nodeFixture('one', {
					organizationId: 'operator',
					isValidator: true,
					isValidating: true
				}),
				nodeFixture('two', {
					organizationId: 'operator',
					isValidator: true,
					isValidating: false
				}),
				nodeFixture('listener', {
					organizationId: 'operator',
					isValidator: false,
					isValidating: false
				})
			],
			[organization]
		);
		expect(getOverviewOrganizations(network)).toEqual([
			{ organization, validators: 2, validating: 1 }
		]);
	});
	it('keeps non-participating organizations visible and sorts names rather than opaque IDs', () => {
		const a = { ...organizationFixture('z-id'), name: 'Alpha' };
		const b = { ...organizationFixture('a-id'), name: 'Beta' };
		expect(
			getOverviewOrganizations(networkFixture([], [b, a])).map(
				(row) => row.organization.name
			)
		).toEqual(['Alpha', 'Beta']);
	});
	it('prioritizes connectivity and validation findings ahead of software baseline warnings', () => {
		const nodes = [
			nodeFixture('software', {
				isValidator: true,
				isValidating: true,
				connectivityError: false,
				stellarCoreVersionBehind: true
			}),
			nodeFixture('connection', {
				isValidator: true,
				isValidating: true,
				connectivityError: true,
				stellarCoreVersionBehind: false
			}),
			nodeFixture('not-validating', {
				isValidator: true,
				isValidating: false,
				connectivityError: false,
				stellarCoreVersionBehind: false
			}),
			nodeFixture('listener', {
				isValidator: false,
				isValidating: false,
				connectivityError: true
			})
		];
		expect(getOverviewAttention(nodes).map((node) => node.publicKey)).toEqual([
			'connection',
			'not-validating',
			'software'
		]);
	});
	it('groups advertised software versions of validating nodes only', () => {
		expect(
			getOverviewVersions([
				nodeFixture('one', {
					isValidating: true,
					versionStr: 'stellar-core 28.0.1 (abcdef1234)'
				}),
				nodeFixture('two', { isValidating: true, versionStr: 'v28.0.1' }),
				nodeFixture('three', { isValidating: false, versionStr: 'v27.1.0' })
			])
		).toEqual([['28.0.1', 2]]);
	});
	it('renders other organizations separately and does not call a configured protocol a live network protocol', () => {
		const current = organizationFixture('Current');
		const other = organizationFixture('Other');
		const network = {
			...networkFixture(
				[
					nodeFixture('one', {
						organizationId: 'Current',
						isValidator: true,
						isValidating: true,
						connectivityError: false,
						stellarCoreVersionBehind: false
					})
				],
				[current, other]
			),
			maxLedgerVersion: 26
		};
		const html = renderToStaticMarkup(<NetworkOverview network={network} />);
		expect(html).toContain('Organizations validating now');
		expect(html).toContain('1 other observed organizations');
		expect(html).toContain('/organizations/Other');
		expect(html).toContain('30-day availability');
		expect(html).not.toContain('Interactive topology moved');
		expect(html).not.toContain('label="Protocol"');
		expect(html).toContain(
			'No validation, connection, or software-baseline findings'
		);
	});
	it('does not report unevaluated quorum intersection as a measured result', () => {
		const network = networkFixture([]);
		network.statistics.hasTransitiveQuorumSet = false;
		const html = renderToStaticMarkup(<NetworkOverview network={network} />);
		expect(html).toContain('Not evaluated');
		expect(html).not.toContain('Quorum intersection</dt><dd>Yes');
	});
});
