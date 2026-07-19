import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import { NodesInTransitiveNetworkQuorumSetFinder } from '../NodesInTransitiveNetworkQuorumSetFinder.js';
import { NetworkQuorumSetConfiguration } from '../../NetworkQuorumSetConfiguration.js';
import NodeMeasurement from '../../../node/NodeMeasurement.js';

describe('NodesInTransitiveNetworkQuorumSetFinder', () => {
	test('should find nodes in transitive network quorum set', () => {
		const nodeInTransitiveQuorumSet = createDummyNode();
		const nodeNotInTransitiveQuorumSet = createDummyNode();
		markValidating(nodeInTransitiveQuorumSet);
		markValidating(nodeNotInTransitiveQuorumSet);

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

	test('excludes configured nodes that are not currently validating', () => {
		const validatingNode = createDummyNode();
		const listener = createDummyNode();
		markValidating(validatingNode);

		const finder = new NodesInTransitiveNetworkQuorumSetFinder();
		const quorumSet = new NetworkQuorumSetConfiguration(
			1,
			[validatingNode.publicKey, listener.publicKey],
			[]
		);

		expect(finder.find([validatingNode, listener], quorumSet)).toEqual([
			validatingNode
		]);
	});
});

function markValidating(node: ReturnType<typeof createDummyNode>): void {
	const measurement = new NodeMeasurement(new Date(), node);
	measurement.isValidating = true;
	node.addMeasurement(measurement);
}
