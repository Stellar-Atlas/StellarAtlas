import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { NodeDTOService } from '@network-scan/services/NodeDTOService.js';
import type {
	KnownNodesDTO,
	KnownNodesInventoryDTO,
	KnownNodeScopeTotals
} from './GetKnownNodesDTO.js';
import {
	toKnownNodeListItemDTO,
	toKnownNodeDTO,
	toPublicKeyOnlyKnownNodeDTO
} from './KnownNodeMapper.js';
import {
	defaultKnownNodesRequest,
	type KnownNetworkPageRequest,
	type KnownNodeScope
} from '../known-network-scope/KnownNetworkScope.js';

@injectable()
export class GetKnownNodes {
	constructor(
		@inject(NETWORK_TYPES.NodeRepository)
		private readonly nodeRepository: NodeRepository,
		@inject(NETWORK_TYPES.OrganizationRepository)
		private readonly organizationRepository: OrganizationRepository,
		@inject(NodeDTOService)
		private readonly nodeDTOService: NodeDTOService,
		@inject('ExceptionLogger')
		private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		request: KnownNetworkPageRequest<KnownNodeScope> = defaultKnownNodesRequest
	): Promise<Result<KnownNodesDTO, Error>> {
		const inventoryOrError = await this.executeAll();
		if (inventoryOrError.isErr()) return err(inventoryOrError.error);

		const inventory = inventoryOrError.value;
		const scopedNodes =
			request.scope === 'all-known'
				? inventory.nodes
				: inventory.nodes.filter((node) => node.scope === request.scope);
		const matchingNodes = filterKnownNodes(scopedNodes, request.query);
		const nodes = matchingNodes.slice(
			request.offset,
			request.offset + request.limit
		);

		return ok({
			...inventory,
			count: matchingNodes.length,
			nodes,
			page: {
				hasMore: request.offset + nodes.length < matchingNodes.length,
				limit: request.limit,
				offset: request.offset,
				total: matchingNodes.length
			},
			scope: request.scope
		});
	}

	async executeAll(): Promise<Result<KnownNodesInventoryDTO, Error>> {
		const generatedAt = new Date();

		try {
			const [nodes, organizations] = await Promise.all([
				this.nodeRepository.findAllKnown(),
				this.organizationRepository.findAllKnown()
			]);
			const nodeIdentities = await this.nodeRepository.findAllKnownIdentities();
			const nodesOrError = await this.nodeDTOService.getNodeDTOs(
				generatedAt,
				nodes,
				organizations
			);

			if (nodesOrError.isErr()) {
				this.exceptionLogger.captureException(nodesOrError.error);
				return err(nodesOrError.error);
			}

			const nodeDtosByPublicKey = new Map(
				nodesOrError.value.map((node) => [node.publicKey, node])
			);
			const knownNodes = nodes.map((node) => {
				const nodeDto = nodeDtosByPublicKey.get(node.publicKey.value);
				if (nodeDto === undefined) {
					throw new Error(`Missing known node DTO for ${node.publicKey.value}`);
				}
				return toKnownNodeListItemDTO(toKnownNodeDTO(node, nodeDto));
			});
			const snapshottedPublicKeys = new Set(
				knownNodes.map((node) => node.publicKey)
			);
			const publicKeyOnlyNodes = nodeIdentities
				.filter((identity) => !snapshottedPublicKeys.has(identity.publicKey))
				.map(toPublicKeyOnlyKnownNodeDTO)
				.map(toKnownNodeListItemDTO);
			const allNodes = [...knownNodes, ...publicKeyOnlyNodes].toSorted(
				(left, right) => left.publicKey.localeCompare(right.publicKey)
			);

			return ok({
				generatedAt: generatedAt.toISOString(),
				count: allNodes.length,
				nodes: allNodes,
				scopeTotals: countScopes(allNodes),
				source: 'postgres_canonical'
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function filterKnownNodes(
	nodes: KnownNodesInventoryDTO['nodes'],
	query: string
): KnownNodesInventoryDTO['nodes'] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return nodes;
	return nodes.filter((knownNode) => {
		const node = knownNode.node;
		return [
			knownNode.publicKey,
			node?.name,
			node?.homeDomain,
			node?.host,
			node?.ip,
			node?.organizationId
		].some((value) => value?.toLowerCase().includes(needle));
	});
}

function countScopes(
	nodes: KnownNodesInventoryDTO['nodes']
): KnownNodeScopeTotals {
	const totals: KnownNodeScopeTotals = {
		'all-known': nodes.length,
		archived: 0,
		'current-validator': 0,
		listener: 0,
		'public-key-only': 0
	};
	for (const node of nodes) totals[node.scope] += 1;
	return totals;
}
