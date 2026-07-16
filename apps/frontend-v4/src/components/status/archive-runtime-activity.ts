export interface ArchiveRuntimeActivity {
	readonly activeChecks: number;
	readonly staleChecks: number;
}

interface ArchiveObjectSample {
	readonly freshActiveObjects: number;
	readonly staleActiveObjects: number;
}

interface ArchiveWorkerSnapshot {
	readonly activeWorkers: number;
	readonly lastHeartbeatAt: string | null;
	readonly registeredWorkers: number;
	readonly staleWorkers: number;
}

export function resolveArchiveRuntimeActivity(
	sample: ArchiveObjectSample,
	workers: ArchiveWorkerSnapshot
): ArchiveRuntimeActivity {
	const hasLiveWorkerSnapshot =
		workers.registeredWorkers > 0 || workers.lastHeartbeatAt !== null;
	if (hasLiveWorkerSnapshot) {
		return {
			activeChecks: workers.activeWorkers,
			staleChecks: workers.staleWorkers
		};
	}

	return {
		activeChecks: sample.freshActiveObjects,
		staleChecks: sample.staleActiveObjects
	};
}
