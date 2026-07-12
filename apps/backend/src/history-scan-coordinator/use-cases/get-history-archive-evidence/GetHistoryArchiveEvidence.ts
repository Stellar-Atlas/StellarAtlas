import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveEvidenceV2 } from 'shared';
import {
	getHistoryArchiveUrlIdentity,
	parseHistoryArchiveUrl
} from '../../domain/ArchiveUrlIdentity.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';
import { GetKnownArchiveEvidence } from '../get-known-archive-evidence/GetKnownArchiveEvidence.js';
import type { ArchiveEvidencePageOptions } from '../get-known-archive-evidence/ArchiveEvidencePagination.js';

@injectable()
export class GetHistoryArchiveEvidence {
	constructor(
		@inject(GetKnownArchiveEvidence)
		private readonly getKnownArchiveEvidence: GetKnownArchiveEvidence
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

		const evidenceResult = await this.getKnownArchiveEvidence.execute({
			fixedArchiveUrlIdentity: archiveUrlIdentity,
			nodePublicKeys: [],
			options,
			roots: [{ archiveUrl, archiveUrlIdentity, nodePublicKeys: [] }],
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
