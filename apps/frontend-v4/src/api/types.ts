import type {
	NetworkV1,
	NodeSnapshotV1,
	NodeV1,
	OrganizationSnapshotV1,
	OrganizationV1,
	HistoryArchiveScanV1
} from 'shared';

export type PublicNetwork = NetworkV1;
export type PublicNode = NodeV1;
export type PublicNodeSnapshot = NodeSnapshotV1;
export type PublicOrganization = OrganizationV1;
export type PublicOrganizationSnapshot = OrganizationSnapshotV1;
export type PublicHistoryArchiveScan = HistoryArchiveScanV1;

export interface ApiFailure {
	message: string;
	statusCode?: number;
}
