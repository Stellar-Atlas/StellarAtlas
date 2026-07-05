import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { Url } from '@core/domain/Url.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import type { ScanEvidence } from '../../domain/scan/ScanEvidence.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';

export interface ArchiveScanEvidenceEntryDTO {
	readonly bucketHash: string;
	readonly bucketUrl: string;
	readonly kind: string;
	readonly observedAt: string;
	readonly status: string;
}

export interface ArchiveScanEvidenceDTO {
	readonly count: number;
	readonly evidence: readonly ArchiveScanEvidenceEntryDTO[];
	readonly limit: number;
	readonly url: string;
}

const defaultEvidenceLimit = 250;
export const maxEvidenceLimit = 5000;

@injectable()
export class GetScanEvidence {
	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private readonly scanRepository: ScanRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		url: string,
		limit = defaultEvidenceLimit
	): Promise<Result<ArchiveScanEvidenceDTO, Error>> {
		const urlOrError = Url.create(url);
		if (urlOrError.isErr()) return err(new InvalidUrlError(url));
		const safeLimit = normalizeLimit(limit);

		try {
			const page = await this.scanRepository.findEvidenceByUrl(
				urlOrError.value.value,
				safeLimit
			);

			return ok({
				count: page.count,
				evidence: page.evidence.map(mapEvidence),
				limit: safeLimit,
				url: urlOrError.value.value
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return defaultEvidenceLimit;
	return Math.min(limit, maxEvidenceLimit);
}

function mapEvidence(evidence: ScanEvidence): ArchiveScanEvidenceEntryDTO {
	return {
		bucketHash: evidence.bucketHash,
		bucketUrl: evidence.bucketUrl,
		kind: evidence.kind,
		observedAt: evidence.observedAt.toISOString(),
		status: evidence.status
	};
}
