import type { PublicOrganization } from '@api/types';
import type {
	PublicKnownOrganizationRecordScope,
	PublicKnownOrganizationScope
} from '@api/known-network-types';
import type { DisplayMetric } from '@domain/availability';
import { getOrganizationTags, type NodeTag } from '@domain/network';
import { formatPercent } from '@format/formatters';

export function organizationInventoryAvailability(
	organization: PublicOrganization,
	scope: PublicKnownOrganizationRecordScope,
	window: '24h' | '30d'
): DisplayMetric {
	const measured =
		window === '24h' ? organization.has24HourStats : organization.has30DayStats;
	if (!measured)
		return {
			value: scope === 'archived' ? 'Not recorded' : 'Collecting',
			tone: 'muted'
		};
	const value =
		window === '24h'
			? organization.subQuorum24HoursAvailability
			: organization.subQuorum30DaysAvailability;
	return {
		value: formatPercent(value),
		tone: scope === 'archived' ? 'muted' : value >= 99.5 ? 'good' : 'warning',
		detail: scope === 'archived' ? 'Historical measurement' : undefined
	};
}

export function organizationInventoryTags(
	organization: PublicOrganization,
	scope: PublicKnownOrganizationRecordScope
): NodeTag[] {
	const tags = getOrganizationTags(organization);
	if (scope === 'current') return tags;
	return [
		{ label: 'archived', tone: 'neutral' },
		...tags.filter(
			(tag) =>
				!['quorum path available', 'quorum path risk', 'low uptime'].includes(
					tag.label
				)
		)
	];
}

export function organizationInventoryHref(
	scope: PublicKnownOrganizationScope,
	query: string,
	page = 1
): string {
	const params = new URLSearchParams({ scope });
	if (query.trim()) params.set('q', query.trim());
	if (page > 1) params.set('page', page.toString());
	return '/organizations?' + params.toString();
}
