import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import { NodeSorter } from '../NodeSorter.js';
import { NetworkQuorumSetConfiguration } from '@network-scan/domain/network/NetworkQuorumSetConfiguration.js';

describe('NodeSorter', () => {
	test('sortByNetworkQuorumSetInclusion', () => {
		const a = createDummyNode();
		const b = createDummyNode();
		const c = createDummyNode();
		const d = createDummyNode();

		const quorumSet = new NetworkQuorumSetConfiguration(
			2,
			[a.publicKey],
			[new NetworkQuorumSetConfiguration(1, [b.publicKey], [])]
		);

		const nodes = [c, d, b, a];
		NodeSorter.sortByNetworkQuorumSetInclusion(nodes, quorumSet);

		function assertAAndBInFront() {
			expect(
				[b.publicKey.value, a.publicKey.value].includes(
					nodes[0].publicKey.value
				)
			).toBeTruthy();
			expect(
				[b.publicKey.value, a.publicKey.value].includes(
					nodes[1].publicKey.value
				)
			).toBeTruthy();
		}

		assertAAndBInFront();
	});
});
