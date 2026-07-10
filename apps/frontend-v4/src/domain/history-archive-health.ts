import type {
	PublicHistoryArchiveObjectSummary,
	PublicStatusLevel
} from '../api/types';

export const archiveHealthVocabulary = [
	'verified',
	'checking',
	'waiting',
	'remote_failure',
	'scanner_issue',
	'unknown'
] as const;

export type ArchiveHealthState = (typeof archiveHealthVocabulary)[number];
export type ArchiveHealthTone = 'good' | 'warning' | 'danger';

type ArchiveEvidenceClass =
	PublicHistoryArchiveObjectSummary['hostThrottles'][number]['evidenceClass'];

export interface ArchiveHealthFacts {
	readonly activeChecks: number;
	readonly checkpointMismatches: number;
	readonly expectedCheckpointProofs: number;
	readonly failedEvidenceRows: number;
	readonly failingArchiveSources: number;
	readonly provenCheckpointProofs: number;
	readonly remoteHostFailures: number;
	readonly scannerIssues: number;
	readonly waitingChecks: number;
}

export interface ArchiveHealthAssessment {
	readonly facts: ArchiveHealthFacts;
	readonly state: ArchiveHealthState;
}

export interface AssessArchiveHealthInput {
	readonly evidenceAvailable: boolean;
	readonly observedActiveChecks?: number;
	readonly scannerIssue?: boolean;
	readonly summary: PublicHistoryArchiveObjectSummary | null;
}

export interface AssessArchiveScannerHealthInput {
	readonly activeChecks: number;
	readonly configuredWorkers: number;
	readonly proofComplete: boolean;
	readonly staleChecks: number;
	readonly telemetryAvailable: boolean;
	readonly waitingChecks: number;
	readonly workerStatus: PublicStatusLevel;
}

export function assessArchiveHealth({
	evidenceAvailable,
	observedActiveChecks = 0,
	scannerIssue = false,
	summary
}: AssessArchiveHealthInput): ArchiveHealthAssessment {
	if (!evidenceAvailable || summary === null) {
		return {
			facts: emptyArchiveHealthFacts(scannerIssue ? 1 : 0),
			state: scannerIssue ? 'scanner_issue' : 'unknown'
		};
	}

	const facts = getArchiveHealthFacts(
		summary,
		observedActiveChecks,
		scannerIssue
	);
	if (hasRemoteFailure(facts)) return { facts, state: 'remote_failure' };
	if (facts.scannerIssues > 0) return { facts, state: 'scanner_issue' };
	if (checkpointProofIsComplete(summary)) return { facts, state: 'verified' };
	if (facts.activeChecks > 0) return { facts, state: 'checking' };
	if (facts.waitingChecks > 0) return { facts, state: 'waiting' };
	return { facts, state: 'unknown' };
}

export function assessArchiveScannerHealth({
	activeChecks,
	configuredWorkers,
	proofComplete,
	staleChecks,
	telemetryAvailable,
	waitingChecks,
	workerStatus
}: AssessArchiveScannerHealthInput): ArchiveHealthState {
	if (!telemetryAvailable) return 'unknown';
	if (
		workerStatus !== 'ok' ||
		staleChecks > 0 ||
		(waitingChecks > 0 && configuredWorkers === 0)
	) {
		return 'scanner_issue';
	}
	if (activeChecks > 0) return 'checking';
	if (waitingChecks > 0) return 'waiting';
	if (proofComplete) return 'verified';
	return 'unknown';
}

export function checkpointProofIsComplete(
	summary: PublicHistoryArchiveObjectSummary
): boolean {
	const checkpoints = summary.checkpoints;
	return (
		checkpoints.expectedArchiveCheckpoints > 0 &&
		checkpoints.categoryConsistentArchiveCheckpoints ===
			checkpoints.expectedArchiveCheckpoints &&
		checkpoints.categoryConsistencyFailedCheckpoints === 0 &&
		checkpoints.categoryConsistencyPendingCheckpoints === 0 &&
		checkpoints.categoryConsistencyNotEvaluatedCheckpoints === 0 &&
		checkpoints.missingArchiveCheckpoints === 0
	);
}

export function getArchiveFailureState(
	evidenceClass: ArchiveEvidenceClass | null
): Extract<ArchiveHealthState, 'remote_failure' | 'scanner_issue' | 'unknown'> {
	if (evidenceClass === 'archive-object') return 'remote_failure';
	if (
		evidenceClass === 'worker-infrastructure' ||
		evidenceClass === 'coordinator-infrastructure'
	) {
		return 'scanner_issue';
	}
	return 'unknown';
}

export function archiveHealthLabel(state: ArchiveHealthState): string {
	if (state === 'remote_failure') return 'Remote failure';
	if (state === 'scanner_issue') return 'Scanner issue';
	return state.charAt(0).toUpperCase() + state.slice(1);
}

export function archiveHealthTone(
	state: ArchiveHealthState
): ArchiveHealthTone {
	if (state === 'verified') return 'good';
	if (state === 'remote_failure') return 'danger';
	return 'warning';
}

function getArchiveHealthFacts(
	summary: PublicHistoryArchiveObjectSummary,
	observedActiveChecks: number,
	scannerIssue: boolean
): ArchiveHealthFacts {
	const checkpoints = summary.checkpoints;
	const infrastructureFailures = summary.hostThrottles.filter(
		(throttle) =>
			getArchiveFailureState(throttle.evidenceClass) === 'scanner_issue'
	).length;
	const remoteHostFailures = summary.hostThrottles.filter(
		(throttle) =>
			getArchiveFailureState(throttle.evidenceClass) === 'remote_failure'
	).length;
	const sourceActiveChecks = summary.sources.reduce(
		(total, source) => total + source.activeObjects,
		0
	);
	const sourceWaitingChecks = summary.sources.reduce(
		(total, source) => total + source.pendingObjects,
		0
	);
	const proofGap = Math.max(
		0,
		checkpoints.expectedArchiveCheckpoints -
			checkpoints.categoryConsistentArchiveCheckpoints -
			checkpoints.categoryConsistencyFailedCheckpoints
	);

	return {
		activeChecks: Math.max(
			0,
			observedActiveChecks,
			summary.activeObjects,
			checkpoints.activeArchiveCheckpoints,
			sourceActiveChecks
		),
		checkpointMismatches: Math.max(
			0,
			checkpoints.categoryConsistencyFailedCheckpoints
		),
		expectedCheckpointProofs: Math.max(
			0,
			checkpoints.expectedArchiveCheckpoints
		),
		failedEvidenceRows: Math.max(0, summary.failedObjects),
		failingArchiveSources: summary.sources.filter(isFailingArchiveSource)
			.length,
		provenCheckpointProofs: Math.max(
			0,
			checkpoints.categoryConsistentArchiveCheckpoints
		),
		remoteHostFailures,
		scannerIssues: infrastructureFailures + (scannerIssue ? 1 : 0),
		waitingChecks: Math.max(
			0,
			summary.pendingObjects,
			checkpoints.categoryConsistencyPendingCheckpoints +
				checkpoints.categoryConsistencyNotEvaluatedCheckpoints +
				checkpoints.missingArchiveCheckpoints,
			sourceWaitingChecks,
			proofGap
		)
	};
}

function isFailingArchiveSource(
	source: PublicHistoryArchiveObjectSummary['sources'][number]
): boolean {
	return (
		source.failedObjects > 0 ||
		source.rootObjectStatus === 'failed' ||
		source.stateStatus === 'invalid' ||
		source.stateStatus === 'unreachable'
	);
}

function hasRemoteFailure(facts: ArchiveHealthFacts): boolean {
	return (
		facts.checkpointMismatches > 0 ||
		facts.failedEvidenceRows > 0 ||
		facts.failingArchiveSources > 0 ||
		facts.remoteHostFailures > 0
	);
}

function emptyArchiveHealthFacts(scannerIssues: number): ArchiveHealthFacts {
	return {
		activeChecks: 0,
		checkpointMismatches: 0,
		expectedCheckpointProofs: 0,
		failedEvidenceRows: 0,
		failingArchiveSources: 0,
		provenCheckpointProofs: 0,
		remoteHostFailures: 0,
		scannerIssues,
		waitingChecks: 0
	};
}
