export type FbasEvidenceSelection = 'latest_completed_network_scan_measurement';
export type FbasProofSetPersistence = 'not_persisted';

export interface FbasLatestSummaryDTO {
	readonly nrOfActiveWatchers: number;
	readonly nrOfConnectableNodes: number;
	readonly nrOfActiveValidators: number;
	readonly nrOfActiveFullValidators: number;
	readonly nrOfActiveOrganizations: number;
	readonly transitiveQuorumSetSize: number;
	readonly hasTransitiveQuorumSet: boolean;
	readonly topTierSize: number;
	readonly topTierOrgsSize: number;
	readonly hasSymmetricTopTier: boolean;
	readonly hasQuorumIntersection: boolean;
	readonly minBlockingSetSize: number;
	readonly minBlockingSetFilteredSize: number;
	readonly minBlockingSetOrgsSize: number;
	readonly minBlockingSetOrgsFilteredSize: number;
	readonly minBlockingSetCountrySize: number;
	readonly minBlockingSetCountryFilteredSize: number;
	readonly minBlockingSetISPSize: number;
	readonly minBlockingSetISPFilteredSize: number;
	readonly minSplittingSetSize: number;
	readonly minSplittingSetOrgsSize: number;
	readonly minSplittingSetCountrySize: number;
	readonly minSplittingSetISPSize: number;
}

export interface LatestFbasDTO {
	readonly generatedAt: string;
	readonly evidenceSelection: FbasEvidenceSelection;
	readonly proofSetPersistence: FbasProofSetPersistence;
	readonly scanId: number;
	readonly scanTime: string;
	readonly latestLedger: string;
	readonly latestLedgerCloseTime: string | null;
	readonly processedLedgers: number[];
	readonly summary: FbasLatestSummaryDTO;
}
