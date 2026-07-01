import { QuorumSet as QuorumSetDTO } from 'shared';
import type { NodeAddress as NodeAddressDTO } from 'crawler';
import Node from '../../Node.js';
import type { NodeAddress } from '../../NodeAddress.js';
import NodeQuorumSet from '../../NodeQuorumSet.js';
import type { Ledger } from 'crawler';

export class CrawlerDTOMapper {
	static mapNodeAddressesToNodeAddressDTOs(
		nodeAddress: NodeAddress[]
	): NodeAddressDTO[] {
		return nodeAddress.map((nodeAddress) => {
			return [nodeAddress.ip, nodeAddress.port];
		});
	}

	static mapNodeToNodeAddressDTOs(nodes: Node[]): NodeAddressDTO[] {
		return nodes.map((node) => {
			return [node.ip, node.port];
		});
	}

	static createQuorumSetDTOMap(nodes: Node[]): Map<string, QuorumSetDTO> {
		return new Map<string, QuorumSetDTO>(
			nodes
				.map((node) => node.quorumSet)
				.filter(
					(quorumSet): quorumSet is NodeQuorumSet =>
						quorumSet instanceof NodeQuorumSet
				)
				.map((quorumSet) => {
					return [quorumSet.hash, quorumSet.quorumSet];
				})
		);
	}

	static toLedgerDTO(
		ledger: bigint | null,
		closeTime: Date | null
	): Ledger | undefined {
		if (ledger !== null && closeTime !== null) {
			return {
				sequence: ledger,
				closeTime: closeTime,
				localCloseTime: closeTime, //todo: storage,
				value: 'value' //todo: storage
			};
		}
		return undefined;
	}
}
