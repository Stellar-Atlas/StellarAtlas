import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import type Organization from '@network-scan/domain/organization/Organization.js';
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
import type { NodeV1 } from 'shared';

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
		const generatedAt = new Date();

		try {
			const organizations = await this.organizationRepository.findAllKnown();
			const page = await this.nodeRepository.findKnownPage({
				...request,
				organizationPublicKeys: matchingOrganizationPublicKeys(
					organizations,
					request.query
				)
			});
			const snapshotNodes = page.items.flatMap((item) =>
				item.node === null ? [] : [item.node]
			);
			const nodeDtosByPublicKey = new Map<string, NodeV1>();
			if (snapshotNodes.length > 0) {
				const nodeDtosOrError = await this.nodeDTOService.getNodeDTOs(
					generatedAt,
					snapshotNodes,
					organizations
				);
				if (nodeDtosOrError.isErr()) {
					this.exceptionLogger.captureException(nodeDtosOrError.error);
					return err(nodeDtosOrError.error);
				}
				for (const node of nodeDtosOrError.value) {
					nodeDtosByPublicKey.set(node.publicKey, node);
				}
			}
			const nodes = page.items.map((item) => {
				if (item.node === null) {
					return toKnownNodeListItemDTO(
						toPublicKeyOnlyKnownNodeDTO(item.identity)
					);
				}
				const nodeDto = nodeDtosByPublicKey.get(item.identity.publicKey);
				if (nodeDto === undefined) {
					throw new Error(
						`Missing paged known node DTO for ${item.identity.publicKey}`
					);
				}
				return toKnownNodeListItemDTO(toKnownNodeDTO(item.node, nodeDto));
			});

			return ok({
				generatedAt: generatedAt.toISOString(),
				count: page.total,
				nodes,
				page: {
					hasMore: request.offset + nodes.length < page.total,
					limit: request.limit,
					offset: request.offset,
					total: page.total
				},
				scope: request.scope,
				scopeTotals: page.scopeTotals,
				source: 'postgres_canonical'
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
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

function matchingOrganizationPublicKeys(
	organizations: readonly Organization[],
	query: string
): string[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return [];

	return organizations
		.filter((organization) =>
			organization.organizationId.value.toLowerCase().includes(needle)
		)
		.flatMap((organization) =>
			organization.validators.value.map((validator) => validator.value)
		);
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
