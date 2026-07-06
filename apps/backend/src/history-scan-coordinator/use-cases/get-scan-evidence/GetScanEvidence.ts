import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { Url } from '@core/domain/Url.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import type { ScanEvidence } from '../../domain/scan/ScanEvidence.js';
import type { HistoryArchiveObject } from '../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
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
		@inject(TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
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
			const objectEvidence =
				await this.objectRepository.findVerifiedBucketObjectsByArchiveUrl(
					urlOrError.value.value,
					safeLimit
				);
			const evidence = dedupeEvidence([
				...objectEvidence.map(mapObjectEvidence),
				...page.evidence.map(mapEvidence)
			]).slice(0, safeLimit);

			return ok({
				count: Math.max(page.count, evidence.length),
				evidence,
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

function mapObjectEvidence(
	object: HistoryArchiveObject
): ArchiveScanEvidenceEntryDTO {
	return {
		bucketHash: object.bucketHash ?? object.objectKey.replace(/^bucket:/, ''),
		bucketUrl: object.objectUrl,
		kind: 'bucket',
		observedAt: (object.verifiedAt ?? object.updatedAt ?? new Date(0)).toISOString(),
		status: 'verified'
	};
}

function dedupeEvidence(
	evidence: readonly ArchiveScanEvidenceEntryDTO[]
): ArchiveScanEvidenceEntryDTO[] {
	const seen = new Set<string>();
	const result: ArchiveScanEvidenceEntryDTO[] = [];
	for (const entry of evidence) {
		const key = `${entry.kind}:${entry.bucketHash}:${entry.bucketUrl}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(entry);
	}

	return result.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}
