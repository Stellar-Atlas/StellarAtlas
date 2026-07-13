import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { HistoryArchiveEvidenceV2 } from 'shared';
import {
	getHistoryArchiveUrlIdentity,
	parseHistoryArchiveUrl
} from '../../domain/ArchiveUrlIdentity.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import { GetKnownArchiveEvidence } from '../get-known-archive-evidence/GetKnownArchiveEvidence.js';
import type { ArchiveEvidencePageOptions } from '../get-known-archive-evidence/ArchiveEvidencePagination.js';
import { getOwnedKnownArchiveRoots } from '../get-known-archive-evidence/KnownArchiveRootOwnership.js';

@injectable()
export class GetHistoryArchiveEvidence {
	constructor(
		@inject(GetKnownArchiveEvidence)
		private readonly getKnownArchiveEvidence: GetKnownArchiveEvidence,
		@inject(NETWORK_TYPES.NodeRepository)
		private readonly nodeRepository: NodeRepository
	) {}

	async execute(
		archiveUrlValue: string,
		options: ArchiveEvidencePageOptions = {}
	): Promise<Result<HistoryArchiveEvidenceV2, Error>> {
		const archiveUrl = parseHistoryArchiveUrl(archiveUrlValue);
		const archiveUrlIdentity =
			archiveUrl === null ? null : getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrl === null || archiveUrlIdentity === null) {
			return err(new InvalidUrlError(archiveUrlValue));
		}

		const knownNodes =
			await this.nodeRepository.findKnownByHistoryUrl(archiveUrlIdentity);
		const ownedRoot = getOwnedKnownArchiveRoots(
			knownNodes.map((node) => ({
				historyUrl: node.details?.historyUrl ?? null,
				publicKey: node.publicKey.value
			}))
		).find((root) => root.archiveUrlIdentity === archiveUrlIdentity) ?? {
			archiveUrl,
			archiveUrlIdentity,
			nodePublicKeys: []
		};
		const evidenceResult = await this.getKnownArchiveEvidence.execute({
			fixedArchiveUrlIdentity: archiveUrlIdentity,
			nodePublicKeys: ownedRoot.nodePublicKeys,
			options,
			roots: [ownedRoot],
			sameOrganizationArchiveUrlIdentities: [archiveUrlIdentity]
		});
		if (evidenceResult.isErr()) return err(evidenceResult.error);

		const evidence = evidenceResult.value;
		const root = evidence.roots[0];
		if (root === undefined)
			return err(new Error('Archive evidence root is missing'));
		return ok({
			archiveUrl,
			eventPage: evidence.eventPage,
			generatedAt: evidence.generatedAt,
			objectPage: evidence.objectPage,
			remoteFailures: evidence.remoteFailures,
			root,
			workerIssues: evidence.workerIssues
		});
	}
}
