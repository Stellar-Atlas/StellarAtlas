import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { toFbasScanMeasurementDTO } from '../../domain/FbasScanMeasurementMapper.js';
import type { LatestFbasDTO } from '../../domain/LatestFbasDTO.js';

@injectable()
export class GetLatestFbas {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<LatestFbasDTO | null, Error>> {
		const generatedAt = new Date().toISOString();

		try {
			const latestScan = await this.networkScanRepository.findLatest();
			if (!latestScan) return ok(null);
			if (!latestScan.measurement) {
				throw new Error('Latest completed network scan measurement not found');
			}

			return ok({
				generatedAt,
				evidenceSelection: 'latest_completed_network_scan_measurement',
				proofSetPersistence: 'not_persisted',
				...toFbasScanMeasurementDTO(latestScan, latestScan.measurement)
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}
