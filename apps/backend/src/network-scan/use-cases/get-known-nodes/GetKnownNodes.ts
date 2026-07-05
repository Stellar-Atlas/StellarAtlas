import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { Snapshot } from '@core/domain/Snapshot.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type Node from '@network-scan/domain/node/Node.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { NodeDTOService } from '@network-scan/services/NodeDTOService.js';
import type { KnownNodeDTO, KnownNodesDTO } from './GetKnownNodesDTO.js';

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

			return ok({
				generatedAt: generatedAt.toISOString(),
				count: knownNodes.length,
				nodes: knownNodes
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function toKnownNodeDTO(
	node: Node,
	nodeDto: KnownNodeDTO['node']
): KnownNodeDTO {
	const current = isCurrentSnapshot(node.snapshotEndDate);
	const lastMeasurementAt =
		node.latestMeasurement()?.time.toISOString() ?? null;
	const snapshotEndDate = node.snapshotEndDate.toISOString();

	return {
		node: nodeDto,
		current,
		snapshotStartDate: node.snapshotStartDate.toISOString(),
		snapshotEndDate,
		lastSeen: lastMeasurementAt ?? (current ? null : snapshotEndDate),
		lastMeasurementAt
	};
}

function isCurrentSnapshot(snapshotEndDate: Date): boolean {
	return snapshotEndDate.getTime() === Snapshot.MAX_DATE.getTime();
}
