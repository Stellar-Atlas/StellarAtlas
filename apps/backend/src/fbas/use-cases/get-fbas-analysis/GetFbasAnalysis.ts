import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { FbasAnalysisDTO } from '../../domain/FbasAnalysisDTO.js';
import { toFbasScanMeasurementDTO } from '../../domain/FbasScanMeasurementMapper.js';

export interface GetFbasAnalysisDTO {
	readonly scanId: number;
}

export class FbasAnalysisValidationError extends Error {}
export const maxFbasScanId = 2147483647;

@injectable()
export class GetFbasAnalysis {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		dto: GetFbasAnalysisDTO
	): Promise<Result<FbasAnalysisDTO | null, Error>> {
		if (
			!Number.isInteger(dto.scanId) ||
			dto.scanId < 1 ||
			dto.scanId > maxFbasScanId
		) {
			return err(
				new FbasAnalysisValidationError(
					'scanId must be a positive 32-bit integer'
				)
			);
		}

		const generatedAt = new Date().toISOString();

		try {
			const scan = await this.networkScanRepository.findCompletedById(
				dto.scanId
			);
			if (!scan) return ok(null);
			if (!scan.measurement) {
				throw new Error(
					`Completed network scan measurement not found for scan ${dto.scanId}`
				);
			}

			return ok({
				generatedAt,
				evidenceSelection: 'completed_network_scan_measurement',
				proofSetPersistence: 'not_persisted',
				...toFbasScanMeasurementDTO(scan, scan.measurement)
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}
