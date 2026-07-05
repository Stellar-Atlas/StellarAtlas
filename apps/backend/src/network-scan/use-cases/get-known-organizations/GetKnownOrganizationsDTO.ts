import type { OrganizationV1 } from 'shared';

export interface KnownOrganizationDTO {
	organization: OrganizationV1;
	current: boolean;
	snapshotStartDate: string;
	snapshotEndDate: string | null;
	lastSeen: string | null;
	lastMeasurementAt: string | null;
}

export interface KnownOrganizationsDTO {
	generatedAt: string;
	count: number;
	organizations: KnownOrganizationDTO[];
}
