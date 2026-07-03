import type NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import type NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { FbasScanMeasurementDTO } from './FbasScanMeasurementDTO.js';
import type { FbasLatestSummaryDTO } from './LatestFbasDTO.js';

export function toFbasScanMeasurementDTO(
	scan: NetworkScan,
	measurement: NetworkMeasurement
): FbasScanMeasurementDTO {
	return {
		scanId: scan.id,
		scanTime: scan.time.toISOString(),
		latestLedger: scan.latestLedger.toString(),
		latestLedgerCloseTime: scan.latestLedgerCloseTime?.toISOString() ?? null,
		processedLedgers: scan.ledgers,
		summary: toFbasLatestSummaryDTO(measurement)
	};
}

export function toFbasLatestSummaryDTO(
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
