import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getArchiveScanDetailPath } from '../../../domain/archive-scan-routes';
import {
	knownNodeFixture,
	networkFixture,
	nodeFixture,
	organizationFixture,
	quorum
} from './node-detail-fixtures';

jest.unstable_mockModule('../../graph/network-graph-canvas', () => ({
	NetworkGraphCanvas: () =>
		createElement('div', { 'aria-label': 'Network trust graph' })
}));
jest.unstable_mockModule(
	'../../archive-scans/archive-repair-plan-panel',
	() => ({
		ArchiveRepairPlanPanel: () =>
			createElement('div', null, 'Loaded repair plan')
	})
);
const { NodeDetail } = await import('../node-detail');
const { NodeArchiveActions } = await import('../node-archive-actions');

describe('node detail evidence-independent navigation', () => {
	it('renders status, directional validator and organization lists, then unavailable evidence without a modal', () => {
		const node = nodeFixture('selected', { quorumSet: quorum('trusted') });
		const network = networkFixture(
			[
				node,
				nodeFixture('trusted', { organizationId: 'Trusted organization' }),
				nodeFixture('trusting', {
					organizationId: 'Trusting organization',
					quorumSet: quorum('selected')
				})
			],
			[
				organizationFixture('Trusted organization'),
				organizationFixture('Trusting organization')
			]
		);
		const html = renderToStaticMarkup(
			createElement(NodeDetail, {
				node,
				network,
				knownNode: knownNodeFixture(node),
				organization: null,
				archiveEvidence: createElement(
					'p',
					null,
					'Archive evidence unavailable'
				)
			})
		);
		expect(html).not.toContain('role="dialog"');
		for (const text of [
			'Node status',
			'Trusts',
			'Trusted by',
			'Validators / nodes',
			'Organizations',
			'Network trust graph',
			'Trusted organization',
			'Trusting organization'
		])
			expect(html).toContain(text);
		expect(html.indexOf('Node status')).toBeLessThan(
			html.indexOf('Archive evidence unavailable')
		);
		expect(html).toContain(
			'href="' + getArchiveScanDetailPath(node.historyUrl!) + '"'
		);
		expect(html).toContain('Repair / download options');
		expect(html).toContain('aria-expanded="false"');
		expect(html).not.toContain('Loaded repair plan');
		expect(html).not.toContain('archive faults');
	});
	it('does not render unsafe archive links or claim missing source metadata is healthy', () => {
		for (const archiveUrl of [null, 'javascript:alert(1)'])
			expect(
				renderToStaticMarkup(createElement(NodeArchiveActions, { archiveUrl }))
			).toBe('');
	});
	it('keeps historical and current network observation times distinct', () => {
		const node = nodeFixture('old', {
			dateUpdated: '2026-08-01T00:00:00Z',
			quorumSet: quorum()
		});
		const html = renderToStaticMarkup(
			createElement(NodeDetail, {
				node,
				network: networkFixture([]),
				knownNode: {
					...knownNodeFixture(node),
					current: false,
					scope: 'archived'
				},
				organization: null,
				archiveEvidence: null
			})
		);
		expect(html).toContain('(historical)');
		expect(html).toContain('2026-08-01T00:00:00.000Z');
		expect(html).toContain('2026-09-07T12:00:00.000Z');
		expect(html).toContain('Recorded availability');
		expect(html).not.toContain('Active now');
		expect(html).not.toContain('Current scan');
	});
});
