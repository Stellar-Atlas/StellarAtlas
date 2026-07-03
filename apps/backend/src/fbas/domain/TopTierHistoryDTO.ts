export type FbasTopTierHistoryEvidenceSelection =
	'network_measurement_day_rollups';

export interface FbasTopTierHistoryMetricDTO {
	readonly average: number | null;
	readonly max: number;
	readonly min: number;
}

export interface FbasTopTierHistoryPointDTO {
	readonly crawlCount: number;
	readonly day: string;
	readonly hasData: boolean;
	readonly hasQuorumIntersectionCount: number;
	readonly hasSymmetricTopTierCount: number;
	readonly hasTransitiveQuorumSetCount: number;
	readonly topTier: FbasTopTierHistoryMetricDTO;
	readonly topTierOrganizations: FbasTopTierHistoryMetricDTO;
}

export interface FbasTopTierHistoryDTO {
	readonly dayCount: number;
	readonly evidenceSelection: FbasTopTierHistoryEvidenceSelection;
	readonly from: string;
	readonly generatedAt: string;
	readonly maxWindowDays: number;
	readonly points: readonly FbasTopTierHistoryPointDTO[];
	readonly proofSetPersistence: 'not_persisted';
	readonly to: string;
}
