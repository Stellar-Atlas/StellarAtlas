import type { HistoryArchiveObjectTypeV1 } from 'shared';

type WorkerStatusLevel = 'ok' | 'degraded' | 'unavailable';

export type ArchiveWorkerStageDTO =
	| 'idle'
	| 'claimed'
	| 'fetching_history_archive_state'
	| 'verified_history_archive_state'
	| 'fetching_checkpoint_state'
	| 'verified_checkpoint_state'
	| 'fetching_ledger'
	| 'downloading_ledger'
	| 'verified_ledger'
	| 'fetching_transactions'
	| 'downloading_transactions'
	| 'verified_transactions'
	| 'fetching_results'
	| 'downloading_results'
	| 'verified_results'
	| 'fetching_scp'
	| 'downloading_scp'
	| 'verified_scp'
	| 'fetching_bucket'
	| 'downloading_bucket'
	| 'verified_bucket';

export type ArchiveWorkerOutcomeDTO =
	'none' | 'verified' | 'archive_error' | 'worker_issue' | 'released';

export interface ArchiveWorkerStatusRowDTO {
	readonly bytesDownloaded: number | null;
	readonly claimAttempt: number | null;
	readonly currentObject: {
		readonly remoteId: string;
		readonly source: string;
		readonly type: HistoryArchiveObjectTypeV1;
	} | null;
	readonly heartbeatAgeMs: number;
	readonly lastHeartbeatAt: string;
	readonly lastOutcome: ArchiveWorkerOutcomeDTO;
	readonly lastOutcomeAt: string | null;
	readonly pid: number;
	readonly processGeneration: number;
	readonly processId: string;
	readonly processStartedAt: string;
	readonly stage: ArchiveWorkerStageDTO;
	readonly status: 'active' | 'idle' | 'stale';
	readonly workerId: string;
}

export interface WorkerStatusDTO {
	readonly archiveWorkers: {
		readonly activeWorkers: number;
		readonly configuredWorkerProcesses: number;
		readonly freshWorkers: number;
		readonly idleWorkers: number;
		readonly lastHeartbeatAt: string | null;
		readonly missingWorkers: number;
		readonly queueActiveWorkers: number;
		readonly queueStaleWorkers: number;
		readonly registeredWorkers: number;
		readonly staleJobAgeMs: number;
		readonly staleWorkers: number;
		readonly startupGraceActive: boolean;
		readonly startupGraceMs: number;
		readonly status: WorkerStatusLevel;
		readonly telemetryMode: 'aggregate-only' | 'per-worker';
		readonly totalTakenJobs: number;
		readonly workers: readonly ArchiveWorkerStatusRowDTO[];
	};
	readonly communityScanners: {
		readonly activeScanners: number;
		readonly blacklistedScanners: number;
		readonly degradedScanners: number;
		readonly heartbeatFreshnessMs: number;
		readonly offlineScanners: number;
		readonly status: WorkerStatusLevel;
		readonly totalScanners: number;
	};
	readonly generatedAt: string;
	readonly status: WorkerStatusLevel;
}

export type PublicWorkerStatus = WorkerStatusDTO;
