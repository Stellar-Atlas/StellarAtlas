import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';

export const scpLiveMaxDrainTimeoutMs =
	scpStatementObservationPolicy.systemdStopTimeoutMs -
	scpStatementObservationPolicy.shutdownKernelBudgetMs -
	scpStatementObservationPolicy.shutdownSystemdHeadroomMs;

export function parseScpLiveShutdownDrainTimeoutMs(
	rawValue: string | undefined
): number {
	const parsed = rawValue === undefined ? Number.NaN : Number(rawValue);
	const requested =
		Number.isInteger(parsed) && parsed > 0
			? parsed
			: scpStatementObservationPolicy.shutdownDrainTimeoutMs;
	return Math.min(requested, scpLiveMaxDrainTimeoutMs);
}

export function getScpLiveProcessShutdownTimeoutMs(
	drainTimeoutMs: number
): number {
	return Math.min(
		drainTimeoutMs + scpStatementObservationPolicy.shutdownKernelBudgetMs,
		scpStatementObservationPolicy.systemdStopTimeoutMs -
			scpStatementObservationPolicy.shutdownSystemdHeadroomMs
	);
}
