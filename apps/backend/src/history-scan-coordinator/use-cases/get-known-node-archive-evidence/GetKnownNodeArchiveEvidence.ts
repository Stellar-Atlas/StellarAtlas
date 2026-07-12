import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { GetKnownNode } from '@network-scan/use-cases/get-known-node/GetKnownNode.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import type { KnownNodeArchiveEvidenceV1 } from 'shared';
import {
	GetKnownArchiveEvidence,
	type OwnedKnownArchiveRoot
} from '../get-known-archive-evidence/GetKnownArchiveEvidence.js';
import type { ArchiveEvidencePageOptions } from '../get-known-archive-evidence/ArchiveEvidencePagination.js';
import {
	getKnownOrganizationArchiveOwnership,
	getOwnedKnownArchiveRoots,
	mergeOwnedKnownArchiveRoots
} from '../get-known-archive-evidence/KnownArchiveRootOwnership.js';

@injectable()
export class GetKnownNodeArchiveEvidence {
	constructor(
		@inject(GetKnownNode) private readonly getKnownNode: GetKnownNode,
		@inject(GetKnownOrganization)
		private readonly getKnownOrganization: GetKnownOrganization,
		@inject(NETWORK_TYPES.NodeRepository)
		private readonly nodeRepository: NodeRepository,
		@inject(GetKnownArchiveEvidence)
		private readonly getKnownArchiveEvidence: GetKnownArchiveEvidence,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		publicKey: string,
		options: ArchiveEvidencePageOptions = {}
	): Promise<Result<KnownNodeArchiveEvidenceV1 | null, Error>> {
		const knownNodeResult = await this.getKnownNode.execute(publicKey);
		if (knownNodeResult.isErr()) return err(knownNodeResult.error);
		const knownNode = knownNodeResult.value;
		if (knownNode === null) return ok(null);

		try {
			const subjectRoots = getOwnedKnownArchiveRoots([
				{
					historyUrl: knownNode.node?.historyUrl ?? null,
					publicKey: knownNode.publicKey
				}
			]);
			const organizationRoots = await this.getOrganizationRoots(
				knownNode.node?.organizationId ?? null,
				subjectRoots
			);
			const evidenceResult = await this.getKnownArchiveEvidence.execute({
				nodePublicKeys: [knownNode.publicKey],
				options,
				roots: subjectRoots,
				sameOrganizationArchiveUrlIdentities: organizationRoots.map(
					(root) => root.archiveUrlIdentity
				)
			});
			if (evidenceResult.isErr()) return err(evidenceResult.error);

			return ok({
				...evidenceResult.value,
				organizationId: knownNode.node?.organizationId ?? null,
				publicKey: knownNode.publicKey
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}

	private async getOrganizationRoots(
		organizationId: string | null,
		subjectRoots: readonly OwnedKnownArchiveRoot[]
	): Promise<readonly OwnedKnownArchiveRoot[]> {
		if (organizationId === null) return subjectRoots;
		const organizationResult =
			await this.getKnownOrganization.execute(organizationId);
		if (organizationResult.isErr()) throw organizationResult.error;
		if (organizationResult.value === null) return subjectRoots;

		const ownership = await getKnownOrganizationArchiveOwnership(
			organizationResult.value,
			this.nodeRepository
		);
		return mergeOwnedKnownArchiveRoots(subjectRoots, ownership.roots);
	}
}
