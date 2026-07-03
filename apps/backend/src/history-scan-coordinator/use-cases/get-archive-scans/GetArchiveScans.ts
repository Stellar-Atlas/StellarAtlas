import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveScan } from 'shared';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { mapScanToHistoryArchiveScan } from '../../infrastructure/mappers/mapScanToHistoryArchiveScan.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

export interface GetArchiveScansDTO {
	readonly limit?: number;
}

export interface ArchiveScansDTO {
	readonly generatedAt: string;
	readonly limit: number;
	readonly count: number;
	readonly scans: readonly HistoryArchiveScan[];
}

@injectable()
export class GetArchiveScans {
	private static readonly defaultLimit = 50;
	static readonly maxLimit = 100;

	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private scanRepository: ScanRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(
		dto: GetArchiveScansDTO = {}
	): Promise<Result<ArchiveScansDTO, Error>> {
		const generatedAt = new Date();
		const limit = this.normalizeLimit(dto.limit);

		try {
			const scans = await this.scanRepository.findLatestLimited(limit);
			const mappedScans = scans.map(mapScanToHistoryArchiveScan);

			return ok({
				generatedAt: generatedAt.toISOString(),
				limit,
				count: mappedScans.length,
				scans: mappedScans
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private normalizeLimit(limit: number | undefined): number {
		if (limit === undefined) return GetArchiveScans.defaultLimit;

		return Math.min(limit, GetArchiveScans.maxLimit);
	}
}
