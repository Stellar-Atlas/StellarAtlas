import type { PublicStatusLevel } from '@api/types';
import type {
	ArchiveHealthAssessment,
	ArchiveHealthState
} from '@domain/history-archive-health';
import { formatInteger } from '@format/formatters';

type HeadlineTone = 'danger' | 'good' | 'warning' | undefined;

export interface ArchiveSourceFindingPresentation {
	readonly detail: string;
	readonly pillText: string;
	readonly tone: HeadlineTone;
	readonly value: string;
}

export interface StatusHeadlineCardModel {
	readonly detail: string;
	readonly key: 'archive-finding' | 'archive-runtime' | 'network' | 'platform';
	readonly label: string;
	readonly tone: HeadlineTone;
	readonly value: string;
}

interface BuildStatusHeadlineCardsInput {
	readonly archiveFinding: ArchiveSourceFindingPresentation;
	readonly archiveRuntime: {
		readonly detail: string;
		readonly state: ArchiveHealthState;
		readonly value: string;
	};
	readonly network: {
		readonly detail: string;
		readonly status: PublicStatusLevel;
	};
	readonly platform: {
		readonly detail: string;
		readonly status: PublicStatusLevel;
	};
}

export function describeArchiveRuntimeHeadline(input: {
	readonly activeChecks: number;
	readonly staleChecks: number;
	readonly state: ArchiveHealthState;
}): string {
	if (input.state === 'scanner_issue' && input.staleChecks > 0) {
		return `${formatInteger(input.staleChecks)} stale checks`;
	}
	if (input.state === 'scanner_issue') return 'Scanner issue';
	if (input.state === 'checking') {
		return `${formatInteger(input.activeChecks)} checks active`;
	}
	if (input.state === 'waiting') return 'Checks queued';
	if (input.state === 'verified') return 'Scanner idle';
	return 'Scanner state unknown';
}

export function combineStatusLevels(
	left: PublicStatusLevel,
	right: PublicStatusLevel
): PublicStatusLevel {
	if (left === 'unavailable' || right === 'unavailable') return 'unavailable';
	if (left === 'degraded' || right === 'degraded') return 'degraded';
	return 'ok';
}

export function buildStatusHeadlineCards({
	archiveFinding,
	archiveRuntime,
	network,
	platform
}: BuildStatusHeadlineCardsInput): readonly StatusHeadlineCardModel[] {
	return [
		{
			detail: platform.detail,
			key: 'platform',
			label: 'Public API',
			tone: serviceTone(platform.status),
			value: serviceLabel(platform.status)
		},
		{
			detail: network.detail,
			key: 'network',
			label: 'Network monitoring',
			tone: serviceTone(network.status),
			value: serviceLabel(network.status)
		},
		{
			detail: archiveRuntime.detail,
			key: 'archive-runtime',
			label: 'Archive verification runtime',
			tone: archiveRuntimeTone(archiveRuntime.state),
			value: archiveRuntime.value
		},
		{
			detail: archiveFinding.detail,
			key: 'archive-finding',
			label: 'Archive integrity',
			tone: archiveFinding.tone,
			value: archiveFinding.value
		}
	];
}

export function describeArchiveSourceFinding(
	health: ArchiveHealthAssessment,
	sourceCount: number
): ArchiveSourceFindingPresentation {
	const facts = health.facts;
	if (facts.checkpointMismatches > 0) {
		return {
			detail:
				'Completed checkpoint validation found files that do not agree by hash. Review the confirmed integrity evidence below.',
			pillText: 'Integrity mismatch',
			tone: 'warning',
			value: formatFindingCount(
				facts.checkpointMismatches,
				'confirmed checkpoint mismatch'
			)
		};
	}
	if (health.state === 'scanner_issue') {
		return {
			detail:
				'Archive evidence collection needs attention. Public API status is reported separately; review worker details below.',
			pillText: 'Collection issue',
			tone: 'warning',
			value: 'Evidence collection issue'
		};
	}
	if (facts.failedEvidenceRows > 0 || facts.scannerIssues > 0) {
		const retryDetails = [
			facts.failedEvidenceRows > 0
				? formatFindingCount(facts.failedEvidenceRows, 'remote file check')
				: null,
			facts.scannerIssues > 0
				? formatFindingCount(facts.scannerIssues, 'scanner-side check')
				: null
		]
			.filter((detail): detail is string => detail !== null)
			.join(' and ');
		return {
			detail: `${formatFindingCount(facts.provenCheckpointProofs, 'current checkpoint proof')} verified across ${formatSourceCount(sourceCount)}; ${retryDetails} awaiting retry.`,
			pillText: 'Remote checks pending',
			tone: undefined,
			value: 'No confirmed integrity mismatches'
		};
	}
	if (health.state === 'verified') {
		return {
			detail: `${formatSourceCount(sourceCount)} checked; completed proofs have no confirmed integrity mismatches.`,
			pillText: 'Sources verified',
			tone: 'good',
			value: 'No confirmed integrity mismatches'
		};
	}
	if (health.state === 'checking') {
		return {
			detail: `${formatSourceCount(sourceCount)} captured; verification is in progress.`,
			pillText: 'Checking sources',
			tone: undefined,
			value: 'Source checks in progress'
		};
	}
	if (health.state === 'waiting') {
		return {
			detail: `${formatSourceCount(sourceCount)} captured; verification work is queued.`,
			pillText: 'Checks queued',
			tone: undefined,
			value: 'Source checks queued'
		};
	}
	return {
		detail:
			'No current archive-source finding can be reported. Public API status is reported separately.',
		pillText: 'Evidence unavailable',
		tone: undefined,
		value: 'Archive evidence unavailable'
	};
}

function formatFindingCount(count: number, label: string): string {
	return `${formatInteger(count)} ${label}${count === 1 ? '' : 's'}`;
}

function formatSourceCount(count: number): string {
	return `${formatInteger(count)} captured archive source${count === 1 ? '' : 's'}`;
}

function serviceLabel(status: PublicStatusLevel): string {
	if (status === 'ok') return 'Operational';
	if (status === 'degraded') return 'Degraded';
	return 'Unavailable';
}

function serviceTone(
	status: PublicStatusLevel
): Exclude<HeadlineTone, undefined> {
	if (status === 'ok') return 'good';
	if (status === 'degraded') return 'warning';
	return 'danger';
}

function archiveRuntimeTone(state: ArchiveHealthState): HeadlineTone {
	if (state === 'verified') return 'good';
	if (state === 'integrity_failure') return 'danger';
	if (state === 'scanner_issue' || state === 'remote_retry') return 'warning';
	return undefined;
}
