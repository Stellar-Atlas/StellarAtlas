export const defaultApiWorkerCount = 4;
export const maxApiWorkerCount = 16;
export const apiWorkerRestartDelayMs = 1_000;

export interface ApiWorkerExitContext {
	readonly exitedAfterDisconnect: boolean;
	readonly shutdownStarted: boolean;
}

export function parseApiWorkerCount(rawValue: string | undefined): number {
	if (rawValue === undefined || rawValue.trim() === '') {
		return defaultApiWorkerCount;
	}

	const normalized = rawValue.trim();
	const parsed = Number(normalized);
	if (
		!/^[1-9]\d*$/.test(normalized) ||
		!Number.isSafeInteger(parsed) ||
		parsed > maxApiWorkerCount
	) {
		throw new Error(
			`API_WORKERS must be a base-10 integer between 1 and ${maxApiWorkerCount}`
		);
	}

	return parsed;
}

export function shouldRestartApiWorker({
	exitedAfterDisconnect,
	shutdownStarted
}: ApiWorkerExitContext): boolean {
	return !shutdownStarted && !exitedAfterDisconnect;
}
