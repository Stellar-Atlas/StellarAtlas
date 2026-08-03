export interface ArchiveRuntimeActivity {
	readonly activeChecks: number;
	readonly staleChecks: number;
}

interface ArchiveObjectSample {
	readonly freshActiveObjects: number;
	readonly staleActiveObjects: number;
}

interface ArchiveWorkerSnapshot {
	readonly lastHeartbeatAt: string | null;
	readonly queueActiveWorkers: number;
	readonly queueStaleWorkers: number;
	readonly registeredWorkers: number;
}

export function resolveArchiveRuntimeActivity(
	sample: ArchiveObjectSample,
	workers: ArchiveWorkerSnapshot
): ArchiveRuntimeActivity {
	const hasLiveWorkerSnapshot =
		workers.registeredWorkers > 0 || workers.lastHeartbeatAt !== null;
	if (hasLiveWorkerSnapshot) {
		return {
			activeChecks: workers.queueActiveWorkers,
			staleChecks: workers.queueStaleWorkers
		};
	}

	return {
		activeChecks: sample.freshActiveObjects,
		staleChecks: sample.staleActiveObjects
	};
}
