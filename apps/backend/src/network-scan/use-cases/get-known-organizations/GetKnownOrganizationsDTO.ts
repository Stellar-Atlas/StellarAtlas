import type { OrganizationV1 } from 'shared';
import type {
	KnownNetworkPageDTO,
	KnownOrganizationRecordScope,
	KnownOrganizationScope
} from '../known-network-scope/KnownNetworkScope.js';

export interface KnownOrganizationDTO {
	organization: OrganizationV1;
	readonly scope: KnownOrganizationRecordScope;
	current: boolean;
	snapshotStartDate: string;
	snapshotEndDate: string | null;
	lastSeen: string | null;
	lastMeasurementAt: string | null;
}

export type KnownOrganizationListItemDTO = KnownOrganizationDTO;

export type KnownOrganizationScopeTotals = Record<
	KnownOrganizationScope,
	number
>;

export interface KnownOrganizationsInventoryDTO {
	generatedAt: string;
	count: number;
	organizations: KnownOrganizationListItemDTO[];
	scopeTotals: KnownOrganizationScopeTotals;
	source: 'postgres_canonical';
}

export interface KnownOrganizationsDTO extends KnownOrganizationsInventoryDTO {
	page: KnownNetworkPageDTO;
	scope: KnownOrganizationScope;
}
