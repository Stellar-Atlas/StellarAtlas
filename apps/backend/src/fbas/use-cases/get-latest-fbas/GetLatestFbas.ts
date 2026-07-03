import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import type NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type {
	FbasLatestSummaryDTO,
	LatestFbasDTO
} from '../../domain/LatestFbasDTO.js';

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

			return ok(
				toLatestFbasDTO(generatedAt, latestScan, latestScan.measurement)
			);
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}
}

function toLatestFbasDTO(
	generatedAt: string,
	scan: NetworkScan,
	measurement: NetworkMeasurement
): LatestFbasDTO {
	return {
		generatedAt,
		evidenceSelection: 'latest_completed_network_scan_measurement',
		proofSetPersistence: 'not_persisted',
		scanId: scan.id,
		scanTime: scan.time.toISOString(),
		latestLedger: scan.latestLedger.toString(),
		latestLedgerCloseTime: scan.latestLedgerCloseTime?.toISOString() ?? null,
		processedLedgers: scan.ledgers,
		summary: toLatestSummaryDTO(measurement)
	};
}

function toLatestSummaryDTO(
	measurement: NetworkMeasurement
): FbasLatestSummaryDTO {
	return {
		nrOfActiveWatchers: measurement.nrOfActiveWatchers,
		nrOfConnectableNodes: measurement.nrOfConnectableNodes,
		nrOfActiveValidators: measurement.nrOfActiveValidators,
		nrOfActiveFullValidators: measurement.nrOfActiveFullValidators,
		nrOfActiveOrganizations: measurement.nrOfActiveOrganizations,
		transitiveQuorumSetSize: measurement.transitiveQuorumSetSize,
		hasTransitiveQuorumSet: measurement.hasTransitiveQuorumSet,
		topTierSize: measurement.topTierSize,
		topTierOrgsSize: measurement.topTierOrgsSize,
		hasSymmetricTopTier: measurement.hasSymmetricTopTier,
		hasQuorumIntersection: measurement.hasQuorumIntersection,
		minBlockingSetSize: measurement.minBlockingSetSize,
		minBlockingSetFilteredSize: measurement.minBlockingSetFilteredSize,
		minBlockingSetOrgsSize: measurement.minBlockingSetOrgsSize,
		minBlockingSetOrgsFilteredSize: measurement.minBlockingSetOrgsFilteredSize,
		minBlockingSetCountrySize: measurement.minBlockingSetCountrySize,
		minBlockingSetCountryFilteredSize:
			measurement.minBlockingSetCountryFilteredSize,
		minBlockingSetISPSize: measurement.minBlockingSetISPSize,
		minBlockingSetISPFilteredSize: measurement.minBlockingSetISPFilteredSize,
		minSplittingSetSize: measurement.minSplittingSetSize,
		minSplittingSetOrgsSize: measurement.minSplittingSetOrgsSize,
		minSplittingSetCountrySize: measurement.minSplittingSetCountrySize,
		minSplittingSetISPSize: measurement.minSplittingSetISPSize
	};
}
