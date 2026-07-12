import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { GetKnownOrganization } from '@network-scan/use-cases/get-known-organization/GetKnownOrganization.js';
import type { KnownOrganizationArchiveEvidenceV1 } from 'shared';
import { GetKnownArchiveEvidence } from '../get-known-archive-evidence/GetKnownArchiveEvidence.js';
import type { ArchiveEvidencePageOptions } from '../get-known-archive-evidence/ArchiveEvidencePagination.js';
import { getKnownOrganizationArchiveOwnership } from '../get-known-archive-evidence/KnownArchiveRootOwnership.js';

@injectable()
export class GetKnownOrganizationArchiveEvidence {
	constructor(
		@inject(GetKnownOrganization)
		private readonly getKnownOrganization: GetKnownOrganization,
		@inject(NETWORK_TYPES.NodeRepository)
		private readonly nodeRepository: NodeRepository,
		@inject(GetKnownArchiveEvidence)
		private readonly getKnownArchiveEvidence: GetKnownArchiveEvidence,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		organizationId: string,
		options: ArchiveEvidencePageOptions = {}
	): Promise<Result<KnownOrganizationArchiveEvidenceV1 | null, Error>> {
		const organizationResult =
			await this.getKnownOrganization.execute(organizationId);
		if (organizationResult.isErr()) return err(organizationResult.error);
		if (organizationResult.value === null) return ok(null);

		try {
			const ownership = await getKnownOrganizationArchiveOwnership(
				organizationResult.value,
				this.nodeRepository
			);
			const evidenceResult = await this.getKnownArchiveEvidence.execute({
				nodePublicKeys: ownership.nodePublicKeys,
				options,
				roots: ownership.roots,
				sameOrganizationArchiveUrlIdentities: ownership.roots.map(
					(root) => root.archiveUrlIdentity
				)
			});
			if (evidenceResult.isErr()) return err(evidenceResult.error);

			return ok({
				...evidenceResult.value,
				organizationId: organizationResult.value.organization.id
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}
