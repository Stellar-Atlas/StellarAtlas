import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import type { NetworkScanFbasProof } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProof.js';
import type {
	FbasMergedProofArtifact,
	FbasProofPayload
} from '@network-scan/domain/network/scan/fbas-analysis/FbasProofPayload.js';
import type { NetworkScanFbasProofRepository } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProofRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type {
	FbasBlockingSetDimensionDTO,
	FbasBlockingSetsDTO,
	FbasLatestProofSetBaseDTO,
	FbasLatestProofSetDTO,
	FbasSplittingSetDimensionDTO,
	FbasSplittingSetsDTO
} from '../../domain/FbasLatestProofSetDTO.js';

export type FbasProofSetKind = 'blocking_sets' | 'splitting_sets';

export interface GetLatestFbasProofSetsRequest {
	readonly kind: FbasProofSetKind;
}

@injectable()
export class GetLatestFbasProofSets {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject(NETWORK_TYPES.NetworkScanFbasProofRepository)
		private readonly fbasProofRepository: NetworkScanFbasProofRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		request: GetLatestFbasProofSetsRequest
	): Promise<Result<FbasLatestProofSetDTO | null, Error>> {
		const generatedAt = new Date().toISOString();

		try {
			const latestScan = await this.networkScanRepository.findLatest();
			if (!latestScan) return ok(null);

			const proof = await this.fbasProofRepository.findByScanId(latestScan.id);
			if (!proof) return ok(null);

			return ok(toLatestProofSetDTO(proof, request.kind, generatedAt));
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.exceptionLogger.captureException(mappedError);
			return err(mappedError);
		}
	}
}

function toLatestProofSetDTO(
	proof: NetworkScanFbasProof,
	kind: FbasProofSetKind,
	generatedAt: string
): FbasLatestProofSetDTO {
	const base = toBaseDTO(proof, generatedAt);

	switch (kind) {
		case 'blocking_sets':
			return {
				...base,
				complete: blockingSetsComplete(proof.payload),
				setType: 'blocking_sets',
				node: toBlockingSetDimensionDTO(proof.payload.node),
				organization: toBlockingSetDimensionDTO(proof.payload.organization),
				country: toBlockingSetDimensionDTO(proof.payload.country),
				isp: toBlockingSetDimensionDTO(proof.payload.isp)
			};
		case 'splitting_sets':
			return {
				...base,
				complete: splittingSetsComplete(proof.payload),
				setType: 'splitting_sets',
				node: toSplittingSetDimensionDTO(proof.payload.node),
				organization: toSplittingSetDimensionDTO(proof.payload.organization),
				country: toSplittingSetDimensionDTO(proof.payload.country),
				isp: toSplittingSetDimensionDTO(proof.payload.isp)
			};
	}

	return assertNever(kind);
}

function toBaseDTO(
	proof: NetworkScanFbasProof,
	generatedAt: string
): FbasLatestProofSetBaseDTO {
	return {
		generatedAt,
		evidenceSelection: 'latest_network_scan_fbas_proof',
		proofSetPersistence: 'persisted',
		scanId: proof.scanId,
		scanTime: proof.scanTime.toISOString(),
		schemaVersion: proof.schemaVersion,
		payloadBytes: proof.payloadBytes,
		limits: proof.payload.limits,
		complete: proof.payload.complete
	};
}

function toBlockingSetDimensionDTO(
	proof: FbasMergedProofArtifact
): FbasBlockingSetDimensionDTO {
	return {
		blockingSets: proof.blockingSets,
		blockingSetsFiltered: proof.blockingSetsFiltered
	};
}

function toSplittingSetDimensionDTO(
	proof: FbasMergedProofArtifact
): FbasSplittingSetDimensionDTO {
	return {
		splittingSets: proof.splittingSets
	};
}

function blockingSetsComplete(payload: FbasProofPayload): boolean {
	return (
		payload.node.blockingSets.complete &&
		payload.node.blockingSetsFiltered.complete &&
		payload.organization.blockingSets.complete &&
		payload.organization.blockingSetsFiltered.complete &&
		payload.country.blockingSets.complete &&
		payload.country.blockingSetsFiltered.complete &&
		payload.isp.blockingSets.complete &&
		payload.isp.blockingSetsFiltered.complete
	);
}

function splittingSetsComplete(payload: FbasProofPayload): boolean {
	return (
		payload.node.splittingSets.complete &&
		payload.organization.splittingSets.complete &&
		payload.country.splittingSets.complete &&
		payload.isp.splittingSets.complete
	);
}

function assertNever(value: never): never {
	throw new Error(`Unhandled FBAS proof set kind: ${value}`);
}
