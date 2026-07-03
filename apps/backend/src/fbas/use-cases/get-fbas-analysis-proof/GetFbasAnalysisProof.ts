import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import type { NetworkScanFbasProofRepository } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProofRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { FbasAnalysisProofDTO } from '../../domain/FbasAnalysisProofDTO.js';
import {
	FbasAnalysisValidationError,
	maxFbasScanId
} from '../get-fbas-analysis/GetFbasAnalysis.js';

export interface GetFbasAnalysisProofRequest {
	readonly scanId: number;
}

@injectable()
export class GetFbasAnalysisProof {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject(NETWORK_TYPES.NetworkScanFbasProofRepository)
		private readonly fbasProofRepository: NetworkScanFbasProofRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		request: GetFbasAnalysisProofRequest
	): Promise<Result<FbasAnalysisProofDTO | null, Error>> {
		if (
			!Number.isInteger(request.scanId) ||
			request.scanId < 1 ||
			request.scanId > maxFbasScanId
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
				request.scanId
			);
			if (!scan) return ok(null);

			const proof = await this.fbasProofRepository.findByScanId(request.scanId);
			if (!proof) return ok(null);

			return ok({
				generatedAt,
				evidenceSelection: 'network_scan_fbas_proof',
				proofSetPersistence: 'persisted',
				scanId: proof.scanId,
				scanTime: proof.scanTime.toISOString(),
				schemaVersion: proof.schemaVersion,
				payloadBytes: proof.payloadBytes,
				proof: proof.payload
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}
