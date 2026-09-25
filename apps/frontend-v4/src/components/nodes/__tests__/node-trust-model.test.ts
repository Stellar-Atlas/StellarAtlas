import { buildNodeTrust, trustOrganizations } from '../node-trust-model';
import {
	networkFixture,
	nodeFixture,
	organizationFixture,
	quorum
} from './node-detail-fixtures';

describe('node directional trust', () => {
	it('includes nested references, deduplicates and does not invent transitive direct trust', () => {
		const selected = nodeFixture('selected', {
			quorumSet: {
				...quorum('selected', 'a'),
				innerQuorumSets: [quorum('a', 'unknown')]
			}
		});
		const a = nodeFixture('a', {
			organizationId: 'org-a',
			quorumSet: quorum('transitive')
		});
		const b = nodeFixture('b', {
			organizationId: 'org-a',
			quorumSet: { ...quorum(), innerQuorumSets: [quorum('selected')] }
		});
		const network = networkFixture(
			[selected, a, b, nodeFixture('transitive')],
			[organizationFixture('org-a')]
		);
		const result = buildNodeTrust(network, selected.publicKey, selected);
		expect(result.trusts.map((item) => item.publicKey)).toEqual([
			'a',
			'unknown'
		]);
		expect(result.trustedBy.map((item) => item.publicKey)).toEqual(['b']);
		expect(result.trusts[1]?.node).toBeNull();
		expect(
			result.graph.edges.map((edge) => [edge.source, edge.target])
		).toEqual([
			['selected', 'a'],
			['b', 'selected']
		]);
		expect(
			trustOrganizations([...result.trusts, ...result.trustedBy]).map(
				(org) => org.id
			)
		).toEqual(['org-a']);
	});
	it('finds incoming references beyond the first inventory page', () => {
		const selected = nodeFixture('selected', { quorumSet: quorum() });
		const nodes = Array.from({ length: 70 }, (_, index) =>
			nodeFixture(`node-${index}`, {
				quorumSet: index === 69 ? quorum('selected') : null
			})
		);
		expect(
			buildNodeTrust(
				networkFixture(nodes),
				selected.publicKey,
				selected
			).trustedBy.map((item) => item.publicKey)
		).toEqual(['node-69']);
	});
	it('retains incoming references for a public-key-only node without inventing its outgoing quorum', () => {
		const result = buildNodeTrust(
			networkFixture([nodeFixture('a', { quorumSet: quorum('unknown') })]),
			'unknown',
			null
		);
		expect(result.quorumAvailable).toBe(false);
		expect(result.trusts).toEqual([]);
		expect(result.trustedBy.map((item) => item.publicKey)).toEqual(['a']);
	});
	it('uses the selected historical quorum only when absent from the current network', () => {
		const historical = nodeFixture('selected', { quorumSet: quorum('old') });
		const result = buildNodeTrust(
			networkFixture([
				nodeFixture('current', { quorumSet: quorum('selected') })
			]),
			'selected',
			historical
		);
		expect(result.trusts.map((item) => item.publicKey)).toEqual(['old']);
		expect(result.trustedBy.map((item) => item.publicKey)).toEqual(['current']);
	});
	it('does not overwrite current quorum or graph data with a retained snapshot', () => {
		const historical = nodeFixture('selected', { quorumSet: quorum('old') });
		const current = nodeFixture('selected', { quorumSet: quorum('new') });
		const result = buildNodeTrust(
			networkFixture([current, nodeFixture('new'), nodeFixture('old')]),
			'selected',
			historical
		);
		expect(result.trusts.map((item) => item.publicKey)).toEqual(['new']);
		expect(
			result.graph.edges.map((edge) => [edge.source, edge.target])
		).toEqual([['selected', 'new']]);
		expect(result.quorumAvailable).toBe(true);
	});
	it('does not restore an old quorum when the current record reports no quorum', () => {
		const result = buildNodeTrust(
			networkFixture([nodeFixture('selected', { quorumSet: null })]),
			'selected',
			nodeFixture('selected', { quorumSet: quorum('old') })
		);
		expect(result.trusts).toEqual([]);
		expect(result.quorumAvailable).toBe(false);
	});
});
