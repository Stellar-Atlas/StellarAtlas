import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { NodeDTOService } from '@network-scan/services/NodeDTOService.js';
import type { KnownNodesDTO } from './GetKnownNodesDTO.js';
import {
	toKnownNodeDTO,
	toPublicKeyOnlyKnownNodeDTO
} from './KnownNodeMapper.js';

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

	async execute(): Promise<Result<KnownNodesDTO, Error>> {
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
				return toKnownNodeDTO(node, nodeDto);
			});
			const snapshottedPublicKeys = new Set(
				knownNodes.map((node) => node.publicKey)
			);
			const publicKeyOnlyNodes = nodeIdentities
				.filter((identity) => !snapshottedPublicKeys.has(identity.publicKey))
				.map(toPublicKeyOnlyKnownNodeDTO);

			return ok({
				generatedAt: generatedAt.toISOString(),
				count: knownNodes.length + publicKeyOnlyNodes.length,
				nodes: [...knownNodes, ...publicKeyOnlyNodes].toSorted((left, right) =>
					left.publicKey.localeCompare(right.publicKey)
				)
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}
