import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import {
	isArchiveMetadataDTO,
	type ArchiveMetadataDTO
} from 'history-scanner-dto';
import type { Logger } from 'logger';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

export interface BackfillArchiveMetadataRequest {
	readonly limit?: number;
}

export interface BackfillArchiveMetadataFailure {
	readonly archiveUrl: string;
	readonly error: string;
}

export interface BackfillArchiveMetadataResult {
	readonly candidateCount: number;
	readonly updatedCount: number;
	readonly skippedCount: number;
	readonly failedCount: number;
	readonly failures: readonly BackfillArchiveMetadataFailure[];
}

const defaultLimit = 5;
const maxLimit = 25;
const fetchTimeoutMs = 5000;

@injectable()
export class BackfillArchiveMetadata {
	static readonly maxLimit = maxLimit;

	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private readonly scanRepository: ScanRepository,
		@inject('Logger') private readonly logger: Logger
	) {}

	async execute(
		request: BackfillArchiveMetadataRequest
	): Promise<Result<BackfillArchiveMetadataResult, Error>> {
		try {
			const limit = normalizeLimit(request.limit);
			const urls =
				await this.scanRepository.findUrlsMissingSelectedArchiveMetadata(limit);
			let updatedCount = 0;
			let skippedCount = 0;
			const failures: BackfillArchiveMetadataFailure[] = [];

			for (const archiveUrl of urls) {
				const metadataResult = await this.fetchArchiveMetadata(archiveUrl);
				if (metadataResult.isErr()) {
					failures.push({
						archiveUrl,
						error: metadataResult.error.message
					});
					continue;
				}

				const updated =
					await this.scanRepository.backfillSelectedArchiveMetadata(
						archiveUrl,
						metadataResult.value
					);
				if (updated) updatedCount += 1;
				else skippedCount += 1;
			}

			return ok({
				candidateCount: urls.length,
				updatedCount,
				skippedCount,
				failedCount: failures.length,
				failures
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	private async fetchArchiveMetadata(
		archiveUrl: string
	): Promise<Result<ArchiveMetadataDTO, Error>> {
		const stellarHistoryUrl = buildStellarHistoryUrl(archiveUrl);
		try {
			const response = await fetch(stellarHistoryUrl, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(fetchTimeoutMs)
			});
			if (!response.ok) {
				return err(
					new Error(`HAS fetch returned HTTP ${response.status.toString()}`)
				);
			}

			const stellarHistory = await response.json();
			const archiveMetadata = {
				stellarHistoryUrl,
				stellarHistory,
				observedAt: new Date().toISOString()
			};
			if (!isArchiveMetadataDTO(archiveMetadata)) {
				return err(new Error('HAS response did not match expected shape'));
			}

			return ok(archiveMetadata);
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.logger.warn('Archive metadata backfill failed', {
				app: 'history-scan-coordinator',
				archiveUrl,
				errorMessage: mappedError.message
			});

			return err(mappedError);
		}
	}
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined) return defaultLimit;
	if (!Number.isSafeInteger(limit)) return defaultLimit;

	return Math.min(Math.max(limit, 1), maxLimit);
}

function buildStellarHistoryUrl(archiveUrl: string): string {
	return `${archiveUrl.replace(/\/+$/, '')}/.well-known/stellar-history.json`;
}
