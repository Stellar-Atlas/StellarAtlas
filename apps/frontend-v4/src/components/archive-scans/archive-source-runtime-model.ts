import type { ArchiveWorkerStatusRowDTO, PublicWorkerStatus } from '@api/types';

const streamStaleAgeMs = 15_000;

export interface ArchiveSourceRuntimeModel {
	readonly status: 'connecting' | 'current' | 'stale' | 'unavailable';
	readonly generatedAt: string | null;
	readonly activeRows: readonly ArchiveWorkerStatusRowDTO[];
	readonly lastReportedRows: readonly ArchiveWorkerStatusRowDTO[];
	readonly completeTelemetry: boolean;
}

export function normalizeArchiveRuntimeSource(source: string): string {
	return source.trim().replace(/\/+$/, '');
}

export function selectSourceWorkerSnapshot(
	current: PublicWorkerStatus | null,
	incoming: PublicWorkerStatus
): PublicWorkerStatus | null {
	const timestamp = Date.parse(incoming.generatedAt);
	if (!Number.isFinite(timestamp)) return current;
	return current === null || timestamp >= Date.parse(current.generatedAt)
		? incoming
		: current;
}

export function getArchiveSourceRuntime({
	archiveUrl,
	workers,
	now,
	lastReceivedAt,
	startedAt,
	streamError
}: {
	readonly archiveUrl: string;
	readonly workers: PublicWorkerStatus | null;
	readonly now: number;
	readonly lastReceivedAt: number | null;
	readonly startedAt: number;
	readonly streamError: boolean;
}): ArchiveSourceRuntimeModel {
	const empty = {
		generatedAt: workers?.generatedAt ?? null,
		activeRows: [],
		lastReportedRows: [],
		completeTelemetry: false
	};
	if (workers === null) {
		return {
			...empty,
			status:
				streamError || now - startedAt >= streamStaleAgeMs
					? 'unavailable'
					: 'connecting'
		};
	}
	const archive = workers.archiveWorkers;
	const root = normalizeArchiveRuntimeSource(archiveUrl);
	const lastReportedRows = archive.workers
		.filter(
			(worker) =>
				worker.currentObject !== null &&
				normalizeArchiveRuntimeSource(worker.currentObject.source) === root
		)
		.sort((left, right) => left.slotIndex - right.slotIndex);
	const staleAgeMs = archive.staleJobAgeMs;
	const snapshotAge = now - Date.parse(workers.generatedAt);
	if (
		streamError ||
		lastReceivedAt === null ||
		now - lastReceivedAt >= streamStaleAgeMs ||
		!Number.isFinite(snapshotAge) ||
		snapshotAge >= staleAgeMs ||
		archive.status === 'unavailable' ||
		archive.telemetryMode !== 'per-worker'
	) {
		return { ...empty, lastReportedRows, status: 'stale' };
	}
	const activeRows = lastReportedRows.filter((worker) => {
		const heartbeatAge = now - Date.parse(worker.lastHeartbeatAt);
		return (
			worker.status === 'active' &&
			Number.isFinite(heartbeatAge) &&
			heartbeatAge < staleAgeMs
		);
	});
	return {
		generatedAt: workers.generatedAt,
		status: 'current',
		activeRows,
		lastReportedRows,
		completeTelemetry:
			archive.missingWorkers === 0 &&
			archive.staleWorkers === 0 &&
			archive.freshWorkers >= archive.configuredWorkerProcesses &&
			archive.configuredWorkerProcesses > 0
	};
}
