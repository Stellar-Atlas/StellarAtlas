import type { PublicNode, PublicOrganization } from '../api/types';
import { formatPercent } from '../format/formatters';

export interface DisplayMetric {
	detail?: string;
	tone: 'good' | 'muted' | 'warning';
	value: string;
}

const minimumUsefulHistoryPercentage = 50;

const isPartialCurrentWindow = (value: number, currentlyHealthy: boolean): boolean =>
	currentlyHealthy && value > 0 && value < minimumUsefulHistoryPercentage;

export const formatNode24HourActive = (node: PublicNode): DisplayMetric => {
	if (!node.statistics.has24HourStats) {
		return { tone: 'muted', value: node.active ? 'Active now' : 'Collecting' };
	}

	return {
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
		tone: node.statistics.validating24HoursPercentage >= 99.5 ? 'good' : 'warning',
		value: formatPercent(node.statistics.validating24HoursPercentage)
	};
};

export const formatNode30DayActive = (node: PublicNode): DisplayMetric => {
	const value = node.statistics.active30DaysPercentage;
	if (!node.statistics.has30DayStats || isPartialCurrentWindow(value, node.active)) {
		return {
			detail: node.active ? 'Current scan is active' : undefined,
			tone: 'muted',
			value: 'Collecting'
		};
	}

	return {
		tone: value >= 99.5 ? 'good' : 'warning',
		value: formatPercent(value)
	};
};

export const formatNode30DayValidating = (node: PublicNode): DisplayMetric => {
	const value = node.statistics.validating30DaysPercentage;
	if (!node.statistics.has30DayStats || isPartialCurrentWindow(value, node.isValidating)) {
		return {
			detail: node.isValidating ? 'Current scan is validating' : undefined,
			tone: 'muted',
			value: 'Collecting'
		};
	}

	return {
		tone: value >= 99.5 ? 'good' : 'warning',
		value: formatPercent(value)
	};
};

export const formatOrganization24HourAvailability = (
	organization: PublicOrganization
): DisplayMetric => {
	if (organization.subQuorumAvailable && organization.subQuorum24HoursAvailability >= 90) {
		return {
			detail: 'Current subquorum is available',
			tone: 'good',
			value: '100%'
		};
	}

	return {
		tone: organization.subQuorum24HoursAvailability >= 99.5 ? 'good' : 'warning',
		value: formatPercent(organization.subQuorum24HoursAvailability)
	};
};

export const formatOrganization30DayAvailability = (
	organization: PublicOrganization
): DisplayMetric => {
	const value = organization.subQuorum30DaysAvailability;
	if (!organization.hasReliableUptime || isPartialCurrentWindow(value, organization.subQuorumAvailable)) {
		return {
			detail: organization.subQuorumAvailable ? 'Current subquorum is available' : undefined,
			tone: 'muted',
			value: 'Collecting'
		};
	}

	return {
		tone: value >= 99.5 ? 'good' : 'warning',
		value: formatPercent(value)
	};
};
