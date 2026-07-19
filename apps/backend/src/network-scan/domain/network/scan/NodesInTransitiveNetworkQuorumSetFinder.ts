import { injectable } from 'inversify';
import Node from '../../node/Node.js';
import { NetworkQuorumSetConfigurationMapper } from '../NetworkQuorumSetConfigurationMapper.js';
import { QuorumSet as BaseQuorumSet } from 'shared';
import NodeQuorumSet from '../../node/NodeQuorumSet.js';
import { NetworkQuorumSetConfiguration } from '../NetworkQuorumSetConfiguration.js';
import { TransitiveQuorumSetFinder } from 'shared';

@injectable()
export class NodesInTransitiveNetworkQuorumSetFinder {
	find(
		nodes: Node[],
		networkQuorumSetConfiguration: NetworkQuorumSetConfiguration
	): Node[] {
		const validatingNodes = nodes.filter((node) => node.isValidating());
		const baseQuorumSet = NetworkQuorumSetConfigurationMapper.toBaseQuorumSet(
			networkQuorumSetConfiguration
		);
		const quorumSetMap = this.getNodesToQuorumSetMap(validatingNodes);
		const transitiveQuorumSet = TransitiveQuorumSetFinder.find(
			baseQuorumSet,
			quorumSetMap
		);

		return validatingNodes.filter((node) =>
			transitiveQuorumSet.has(node.publicKey.value)
		);
	}

	private getNodesToQuorumSetMap(nodes: Node[]) {
		return new Map<string, BaseQuorumSet>(
			nodes
				.filter((node) => node.quorumSet)
				.map((node) => [
					node.publicKey.value,
					(node.quorumSet as NodeQuorumSet).quorumSet
				])
		);
	}
}
