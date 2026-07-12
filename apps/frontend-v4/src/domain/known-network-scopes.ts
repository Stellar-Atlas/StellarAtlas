import type {
	PublicKnownNodeListItem,
	PublicKnownNodeScope,
	PublicKnownOrganizationListItem,
	PublicKnownOrganizationScope
} from '../api/known-network-types';

export type NodeInventoryFilter = PublicKnownNodeScope;

export const defaultNodeInventoryFilter: NodeInventoryFilter =
	'current-validator';
export const defaultOrganizationInventoryFilter: PublicKnownOrganizationScope =
	'current';

export const nodeInventoryFilterOrder: readonly NodeInventoryFilter[] = [
	'current-validator',
	'listener',
	'public-key-only',
	'archived',
	'all-known'
];

export const organizationInventoryFilterOrder: readonly PublicKnownOrganizationScope[] =
	['current', 'archived', 'all-known'];

export const nodeInventoryFilterLabels: Record<NodeInventoryFilter, string> = {
	'all-known': 'All known',
	archived: 'Archived / inactive',
	'current-validator': 'Current validators',
	listener: 'Current listeners',
	'public-key-only': 'Public-key only'
};

export const organizationInventoryFilterLabels: Record<
	PublicKnownOrganizationScope,
	string
> = {
	'all-known': 'All known',
	archived: 'Archived',
	current: 'Current'
};

export function isNodeInventoryFilter(
	value: string
): value is NodeInventoryFilter {
	return nodeInventoryFilterOrder.some((filter) => filter === value);
}

export function isOrganizationInventoryFilter(
	value: string
): value is PublicKnownOrganizationScope {
	return organizationInventoryFilterOrder.some((filter) => filter === value);
}

export function matchesNodeInventoryFilter(
	knownNode: PublicKnownNodeListItem,
	filter: NodeInventoryFilter
): boolean {
	return filter === 'all-known' || knownNode.scope === filter;
}

export function matchesOrganizationInventoryFilter(
	organization: PublicKnownOrganizationListItem,
	filter: PublicKnownOrganizationScope
): boolean {
	return filter === 'all-known' || organization.scope === filter;
}
