import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import PublicKey from '@network-scan/domain/node/PublicKey.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { NodeDTOService } from '@network-scan/services/NodeDTOService.js';
import type { KnownNodeDTO } from '../get-known-nodes/GetKnownNodesDTO.js';
import {
	toKnownNodeDTO,
	toPublicKeyOnlyKnownNodeDTO
} from '../get-known-nodes/KnownNodeMapper.js';

@injectable()
export class GetKnownNode {
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
		publicKeyValue: string
	): Promise<Result<KnownNodeDTO | null, Error>> {
		const publicKeyOrError = PublicKey.create(publicKeyValue);
		if (publicKeyOrError.isErr()) return ok(null);
		const generatedAt = new Date();

		try {
			const node = await this.nodeRepository.findOneByPublicKey(
				publicKeyOrError.value
			);

			if (node === null) {
				const identity =
					await this.nodeRepository.findKnownIdentityByPublicKey(
						publicKeyValue
					);
				return ok(identity ? toPublicKeyOnlyKnownNodeDTO(identity) : null);
			}

			const organizations = await this.organizationRepository.findAllKnown();
			const nodeDtosOrError = await this.nodeDTOService.getNodeDTOs(
				generatedAt,
				[node],
				organizations
			);

			if (nodeDtosOrError.isErr()) {
				this.exceptionLogger.captureException(nodeDtosOrError.error);
				return err(nodeDtosOrError.error);
			}

			const nodeDto = nodeDtosOrError.value[0];
			if (nodeDto === undefined) {
				throw new Error(`Missing known node DTO for ${node.publicKey.value}`);
			}

			return ok(toKnownNodeDTO(node, nodeDto));
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}
