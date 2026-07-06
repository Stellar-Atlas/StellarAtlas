import { Url } from '@core/domain/Url.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { getHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import type { HistoryArchiveStateRepository } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateRepository.js';
import { HistoryArchiveStateSnapshot } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { mapHistoryArchiveStateSnapshot } from '@history-scan-coordinator/infrastructure/mappers/mapHistoryArchiveStateSnapshot.js';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { HistoryArchiveStateSnapshotV1 } from 'shared';
import { InvalidUrlError } from '../get-latest-scan/InvalidUrlError.js';

@injectable()
export class GetHistoryArchiveState {
	constructor(
		@inject(TYPES.HistoryArchiveStateRepository)
		private readonly stateRepository: HistoryArchiveStateRepository,
		@inject(TYPES.HistoryArchiveScanRepository)
		private readonly scanRepository: ScanRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		url: string
	): Promise<
		Result<HistoryArchiveStateSnapshotV1 | null, InvalidUrlError | Error>
	> {
		const urlOrError = Url.create(url);
		if (urlOrError.isErr()) return err(new InvalidUrlError(url));

		try {
			const normalizedUrl = urlOrError.value.value;
			const persistedState = await this.findPersistedState(normalizedUrl);
			if (persistedState !== null) {
				return ok(mapHistoryArchiveStateSnapshot(persistedState));
			}

			const latestScan = await this.scanRepository.findLatestByUrl(normalizedUrl);
			if (latestScan === null || latestScan.archiveMetadata === null) {
				return ok(null);
			}

			const archiveUrlIdentity = getHistoryArchiveUrlIdentity(normalizedUrl);
			if (archiveUrlIdentity === null) return ok(null);

			return ok(
				mapHistoryArchiveStateSnapshot(
					HistoryArchiveStateSnapshot.available(
						normalizedUrl,
						archiveUrlIdentity,
						latestScan.archiveMetadata,
						'history-scanner'
					)
				)
			);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private async findPersistedState(url: string) {
		try {
			return await this.stateRepository.findByUrl(url);
		} catch (error) {
			if (isMissingArchiveStateTableError(error)) return null;
			throw error;
		}
	}
}

function isMissingArchiveStateTableError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		(error as { code?: unknown }).code === '42P01'
	);
}
