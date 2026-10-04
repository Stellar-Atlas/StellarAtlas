import type {
	NodeV1 as PublicNode,
	OrganizationV1 as PublicOrganization
} from 'shared';
import { formatInteger, formatPercent } from '../format/formatters';

export interface DisplayMetric {
	detail?: string;
	tone: 'good' | 'muted' | 'warning';
	value: string;
}

export const hasEvaluatedOrganization30DayAvailability = (
	organization: PublicOrganization
): boolean => organization.has30DayStats;

export function organizationAvailabilityCoverageDetail(
	organization: PublicOrganization
): string | undefined {
	const coverage = organization.availability30DaysCoverage;
	if (!coverage) return undefined;
	return `${coverage.observedDays} observed ${coverage.observedDays === 1 ? 'day' : 'days'} · monitoring gaps excluded`;
}

export const formatNode24HourActive = (node: PublicNode): DisplayMetric => {
	if (!node.statistics.has24HourStats) {
		return { tone: 'muted', value: node.active ? 'Active now' : 'Collecting' };
	}

	return {
		detail: nodeAvailabilityCoverageDetail(node, '24h'),
		tone: node.statistics.active24HoursPercentage >= 99.5 ? 'good' : 'warning',
		value: formatPercent(node.statistics.active24HoursPercentage)
	};
};

export const formatNode24HourValidating = (node: PublicNode): DisplayMetric => {
	if (!node.statistics.has24HourStats) {
		return {
			tone: 'muted',
			value: node.isValidating ? 'Validating now' : 'Collecting'
		};
	}

	return {
		detail: nodeAvailabilityCoverageDetail(node, '24h'),
		tone:
			node.statistics.validating24HoursPercentage >= 99.5 ? 'good' : 'warning',
		value: formatPercent(node.statistics.validating24HoursPercentage)
	};
};

export const formatNode30DayActive = (node: PublicNode): DisplayMetric => {
	const value = node.statistics.active30DaysPercentage;
	if (!node.statistics.has30DayStats) {
		return {
			detail: node.active ? 'Current scan is active' : undefined,
			tone: 'muted',
			value: 'Collecting'
		};
	}

	return {
		detail: nodeAvailabilityCoverageDetail(node, '30d'),
		tone: value >= 99.5 ? 'good' : 'warning',
		value: formatPercent(value)
	};
};

export const formatNode30DayValidating = (node: PublicNode): DisplayMetric => {
	const value = node.statistics.validating30DaysPercentage;
	if (!node.statistics.has30DayStats) {
		return {
			detail: node.isValidating ? 'Current scan is validating' : undefined,
			tone: 'muted',
			value: 'Collecting'
		};
	}

	return {
		detail: nodeAvailabilityCoverageDetail(node, '30d'),
		tone: value >= 99.5 ? 'good' : 'warning',
		value: formatPercent(value)
	};
};

function nodeAvailabilityCoverageDetail(
	node: PublicNode,
	window: '24h' | '30d'
): string | undefined {
	const coverage =
		window === '24h'
			? node.statistics.availability24HoursCoverage
			: node.statistics.availability30DaysCoverage;
	if (!coverage) return undefined;
	const observed =
		window === '24h'
			? `${formatInteger(coverage.observedScans)} observed ${coverage.observedScans === 1 ? 'scan' : 'scans'}`
			: `${coverage.observedDays} observed ${coverage.observedDays === 1 ? 'day' : 'days'}`;
	return `${observed} · monitoring gaps excluded`;
}

export const formatOrganization24HourAvailability = (
	organization: PublicOrganization
): DisplayMetric => {
	if (!organization.has24HourStats)
		return { tone: 'muted', value: 'Collecting' };

	return {
		tone:
			organization.subQuorum24HoursAvailability >= 99.5 ? 'good' : 'warning',
		value: formatPercent(organization.subQuorum24HoursAvailability)
	};
};

export const formatOrganization30DayAvailability = (
	organization: PublicOrganization
): DisplayMetric => {
	const value = organization.subQuorum30DaysAvailability;
	if (!hasEvaluatedOrganization30DayAvailability(organization)) {
		return {
			detail: organization.subQuorumAvailable
				? 'Current subquorum is available'
				: undefined,
			tone: 'muted',
			value: 'Collecting'
		};
	}

	return {
		detail: organizationAvailabilityCoverageDetail(organization),
		tone: value >= 99.5 ? 'good' : 'warning',
		value: formatPercent(value)
	};
};
