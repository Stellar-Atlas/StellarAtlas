import { historyArchiveConsumerCount } from '../../domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
const defaultTransitionReconciliationIntervalMs = 1_000;
const defaultExecutionAdmissionIntervalMs = 1_000;
const minimumMaintenanceIntervalMs = 1_000;
const maximumTargetedProofRefreshBatchSize = historyArchiveConsumerCount;
const defaultTargetedProofRefreshBatchSize =
	maximumTargetedProofRefreshBatchSize;

export interface HistoryArchiveMaintenanceIntervals {
	readonly executionAdmissionIntervalMs: number;
	readonly transitionReconciliationIntervalMs: number;
}

export interface HistoryArchiveMaintenanceLanes {
	readonly checkpointDependencyReconciliationEnabled: boolean;
	readonly executionAdmissionEnabled: boolean;
	readonly promotePlannedObjectsEnabled: boolean;
	readonly terminalTransitionReconciliationEnabled: boolean;
	readonly targetedProofRefreshEnabled: boolean;
	readonly targetedProofRefreshMaximumPriority: 0 | 1;
}

export function historyArchiveMaintenanceIntervalsFromEnv(
	env: NodeJS.ProcessEnv = process.env
): HistoryArchiveMaintenanceIntervals {
	return Object.freeze({
		executionAdmissionIntervalMs: parseMaintenanceIntervalMs(
			env.HISTORY_ARCHIVE_EXECUTION_ADMISSION_INTERVAL_MS,
			defaultExecutionAdmissionIntervalMs
		),
		transitionReconciliationIntervalMs: parseMaintenanceIntervalMs(
			env.HISTORY_ARCHIVE_TRANSITION_RECONCILIATION_INTERVAL_MS,
			defaultTransitionReconciliationIntervalMs
		)
	});
}

export function historyArchiveMaintenanceLanesFromEnv(
	env: NodeJS.ProcessEnv = process.env
): HistoryArchiveMaintenanceLanes {
	return Object.freeze({
		checkpointDependencyReconciliationEnabled: parseMaintenanceLaneEnabled(
			env.HISTORY_ARCHIVE_CHECKPOINT_DEPENDENCY_RECONCILIATION_ENABLED
		),
		executionAdmissionEnabled: parseMaintenanceLaneEnabled(
			env.HISTORY_ARCHIVE_EXECUTION_ADMISSION_ENABLED
		),
		promotePlannedObjectsEnabled: parseMaintenanceLaneEnabled(
			env.HISTORY_ARCHIVE_PROMOTE_PLANNED_OBJECTS_ENABLED
		),
		terminalTransitionReconciliationEnabled: parseMaintenanceLaneEnabled(
			env.HISTORY_ARCHIVE_TERMINAL_TRANSITION_RECONCILIATION_ENABLED
		),
		targetedProofRefreshEnabled:
			env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_ENABLED === 'true',
		targetedProofRefreshMaximumPriority: parseTargetedProofRefreshPriority(
			env.HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_MAX_PRIORITY
		)
	});
}

export function parseTargetedProofRefreshPriority(
	value: string | undefined
): 0 | 1 {
	if (value === undefined || value === '0') return 0;
	if (value === '1') return 1;
	throw new Error(
		'HISTORY_ARCHIVE_TARGETED_PROOF_REFRESH_MAX_PRIORITY must be 0 or 1'
	);
}

export function parseTargetedProofRefreshBatchSize(
	configuredBatchSize: string | undefined
): number {
	if (configuredBatchSize === undefined) {
		return defaultTargetedProofRefreshBatchSize;
	}
	const parsed = Number(configuredBatchSize);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		return defaultTargetedProofRefreshBatchSize;
	}
	return Math.min(parsed, maximumTargetedProofRefreshBatchSize);
}

export function parseHistoryArchiveMaintenanceIntervalMs(
	configuredIntervalMs: string | undefined
): number {
	return parseMaintenanceIntervalMs(
		configuredIntervalMs,
		defaultTransitionReconciliationIntervalMs
	);
}

function parseMaintenanceIntervalMs(
	configuredIntervalMs: string | undefined,
	defaultIntervalMs: number
): number {
	if (configuredIntervalMs === undefined) return defaultIntervalMs;

	const parsedIntervalMs = Number(configuredIntervalMs);
	return Number.isSafeInteger(parsedIntervalMs) &&
		parsedIntervalMs >= minimumMaintenanceIntervalMs
		? parsedIntervalMs
		: defaultIntervalMs;
}

// Unset preserves the legacy behavior. Once an operator sets a lane control,
// only the exact value "true" enables writes; typos fail closed.
function parseMaintenanceLaneEnabled(
	configuredValue: string | undefined
): boolean {
	return configuredValue === undefined || configuredValue === 'true';
}
