export interface OrganizationMeasurementAverage {
	organizationId: string;
	isSubQuorumAvailableAvg: number;
	coverage?: { observedDays: number; observedScans: number };
}
