import type { NetworkV1, NodeV1, OrganizationV1 } from 'shared';

export type PublicNetwork = NetworkV1;
export type PublicNode = NodeV1;
export type PublicOrganization = OrganizationV1;

export interface ApiFailure {
	message: string;
	statusCode?: number;
}
