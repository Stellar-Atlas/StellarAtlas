import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import { NodesInTransitiveNetworkQuorumSetFinder } from '../NodesInTransitiveNetworkQuorumSetFinder.js';
import { NetworkQuorumSetConfiguration } from '../../NetworkQuorumSetConfiguration.js';

describe('NodesInTransitiveNetworkQuorumSetFinder', () => {
	test('should find nodes in transitive network quorum set', () => {
		const nodeInTransitiveQuorumSet = createDummyNode();
		const nodeNotInTransitiveQuorumSet = createDummyNode();

		const nodes = [nodeInTransitiveQuorumSet, nodeNotInTransitiveQuorumSet];

		const finder = new NodesInTransitiveNetworkQuorumSetFinder();
		const quorumSet = new NetworkQuorumSetConfiguration(
			1,
			[nodeInTransitiveQuorumSet.publicKey],
			[]
		);
		const nodesInTransitiveQuorumSet = finder.find(nodes, quorumSet);

		expect(nodesInTransitiveQuorumSet).toEqual([nodeInTransitiveQuorumSet]);
	});
});
