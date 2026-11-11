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
import type { HistoryArchiveStateRepository } from '../../domain/history-archive-state/HistoryArchiveStateRepository.js';
import type { HistoryArchiveStateStatus } from '../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import { AxiosHttpService, Url, type HttpService } from 'http-helper';

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
		@inject(TYPES.HistoryArchiveStateRepository)
		private readonly stateRepository: HistoryArchiveStateRepository,
		@inject('Logger') private readonly logger: Logger,
		@inject('HttpService')
		private readonly httpService: HttpService = new AxiosHttpService(
			'StellarAtlas archive state backfill'
		)
	) {}

	async execute(
		request: BackfillArchiveMetadataRequest
	): Promise<Result<BackfillArchiveMetadataResult, Error>> {
		try {
			const limit = normalizeLimit(request.limit);
			const scanUrls =
				await this.scanRepository.findUrlsMissingSelectedArchiveMetadata(limit);
			const discoveredUrls =
				await this.scanRepository.findDiscoveredUrlsMissingArchiveState(limit);
			const urls = dedupeArchiveUrls([...scanUrls, ...discoveredUrls]).slice(
				0,
				limit
			);
			let updatedCount = 0;
			let skippedCount = 0;
			const failures: BackfillArchiveMetadataFailure[] = [];

			for (const archiveUrl of urls) {
				const metadataResult = await this.fetchArchiveMetadata(archiveUrl);
				if (metadataResult.isErr()) {
					await this.saveFetchFailure(archiveUrl, metadataResult.error);
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
				await this.stateRepository.saveAvailable(
					archiveUrl,
					metadataResult.value,
					'backfill'
				);
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
			const url = Url.create(stellarHistoryUrl);
			if (url.isErr()) return err(url.error);
			const response = await this.httpService.get(url.value, {
				publicArchive: true,
				headers: { accept: 'application/json' },
				requestTimeoutMs: fetchTimeoutMs,
				socketTimeoutMs: fetchTimeoutMs
			});
			if (response.isErr()) {
				return err(
					new ArchiveStateFetchError(
						response.error.message,
						'unreachable',
						response.error.code ?? 'http_error',
						response.error.response?.status ?? null
					)
				);
			}

			const stellarHistory = response.value.data;
			const archiveMetadata = {
				stellarHistoryUrl,
				stellarHistory,
				observedAt: new Date().toISOString()
			};
			if (!isArchiveMetadataDTO(archiveMetadata)) {
				return err(
					new ArchiveStateFetchError(
						'History archive state response did not match expected shape',
						'invalid',
						'invalid_shape'
					)
				);
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

	private async saveFetchFailure(
		archiveUrl: string,
		error: Error
	): Promise<void> {
		const fetchError =
			error instanceof ArchiveStateFetchError
				? error
				: new ArchiveStateFetchError(
						error.message,
						'unreachable',
						error.name || 'fetch_error'
					);

		await this.stateRepository.saveFailure({
			archiveUrl,
			stateUrl: buildStellarHistoryUrl(archiveUrl),
			status: fetchError.status,
			errorType: fetchError.errorType,
			errorMessage: fetchError.message,
			httpStatus: fetchError.httpStatus,
			observedAt: new Date(),
			source: 'backfill'
		});
	}
}

class ArchiveStateFetchError extends Error {
	constructor(
		message: string,
		public readonly status: Exclude<HistoryArchiveStateStatus, 'available'>,
		public readonly errorType: string,
		public readonly httpStatus: number | null = null
	) {
		super(message);
		this.name = 'ArchiveStateFetchError';
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

function dedupeArchiveUrls(urls: readonly string[]): string[] {
	const byIdentity = new Map<string, string>();
	for (const url of urls) {
		const identity = url.replace(/\/+$/, '').toLowerCase();
		if (!byIdentity.has(identity)) byIdentity.set(identity, url);
	}

	return [...byIdentity.values()];
}
