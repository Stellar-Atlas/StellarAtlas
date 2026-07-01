import { Url } from '../../../core/domain/Url.js';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';
import { GetLatestScanDTO } from './GetLatestScanDTO.js';
import { HistoryArchiveScan } from 'shared';
import { InvalidUrlError } from './InvalidUrlError.js';
import { Result, err, ok } from 'neverthrow';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../infrastructure/di/di-types.js';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import 'reflect-metadata';
import { mapScanToHistoryArchiveScan } from '../../infrastructure/mappers/mapScanToHistoryArchiveScan.js';

@injectable()
export class GetLatestScan {
	constructor(
		@inject(TYPES.HistoryArchiveScanRepository)
		private scanRepository: ScanRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(
		dto: GetLatestScanDTO
	): Promise<Result<HistoryArchiveScan | null, InvalidUrlError | Error>> {
		const urlOrError = Url.create(dto.url);
		if (urlOrError.isErr()) return err(new InvalidUrlError(dto.url));
		try {
			const scan = await this.scanRepository.findLatestByUrl(
				urlOrError.value.value
			);

			if (scan === null) return ok(null);

			return ok(mapScanToHistoryArchiveScan(scan));
		} catch (e) {
			this.exceptionLogger.captureException(mapUnknownToError(e));
			return err(mapUnknownToError(e));
		}
	}
}
