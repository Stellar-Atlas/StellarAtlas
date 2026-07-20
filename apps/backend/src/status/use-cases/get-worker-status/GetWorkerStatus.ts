import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type {
	HistoryArchiveWorkerStatus,
	HistoryArchiveWorkerStatusRepository
} from '@history-scan-coordinator/domain/history-archive-worker/HistoryArchiveWorkerStatus.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { getWorstStatus, type StatusLevel } from '../../domain/StatusTypes.js';

const archiveObjectWorkerStaleAgeMs = 2 * 60 * 1000;
const archiveObjectWorkerPublicRetentionMs = 15 * 60 * 1000;
const archiveObjectWorkerStorageRetentionMs = 24 * 60 * 60 * 1000;
const archiveObjectWorkerStartupGraceMs = 2 * 60 * 1000;
const archiveObjectWorkerRowLimit = 128;
const defaultConfiguredObjectWorkers = 24;
const maxConfiguredObjectWorkers = 24;

export interface ArchiveWorkerStatusDTO {
	readonly status: StatusLevel;
	readonly activeWorkers: number;
	readonly configuredWorkerProcesses: number;
	readonly freshWorkers: number;
	readonly idleWorkers: number;
	readonly lastHeartbeatAt: string | null;
	readonly missingWorkers: number;
	readonly queueActiveWorkers: number;
	readonly queueStaleWorkers: number;
	readonly registeredWorkers: number;
	readonly startupGraceActive: boolean;
	readonly startupGraceMs: number;
	readonly staleWorkers: number;
	readonly telemetryMode: 'per-worker';
	readonly totalTakenJobs: number;
	readonly staleJobAgeMs: number;
	readonly workers: readonly ArchiveWorkerRowDTO[];
}

export interface ArchiveWorkerRowDTO {
	readonly bytesDownloaded: number | null;
	readonly bytesTotal: number | null;
	readonly claimAttempt: number | null;
	readonly currentObject: HistoryArchiveWorkerStatus['currentObject'];
	readonly heartbeatAgeMs: number;
	readonly lastHeartbeatAt: string;
	readonly lastOutcome: HistoryArchiveWorkerStatus['lastOutcome'];
	readonly lastOutcomeAt: string | null;
	readonly pid: number;
	readonly processGeneration: number;
	readonly processId: string;
	readonly processStartedAt: string;
	readonly slotIndex: number;
	readonly stage: HistoryArchiveWorkerStatus['stage'];
	readonly status: 'active' | 'idle' | 'stale';
	readonly workerId: string;
}

export interface CommunityScannerStatusDTO {
	readonly status: StatusLevel;
	readonly totalScanners: number;
	readonly activeScanners: number;
	readonly offlineScanners: number;
	readonly degradedScanners: number;
	readonly blacklistedScanners: number;
	readonly heartbeatFreshnessMs: number;
}

export interface WorkerStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly archiveWorkers: ArchiveWorkerStatusDTO;
	readonly communityScanners: CommunityScannerStatusDTO;
}

@injectable()
export class GetWorkerStatus {
	constructor(
		@inject(GetScannerMetrics)
		private readonly getScannerMetrics: GetScannerMetrics,
		@inject(HISTORY_TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(HISTORY_TYPES.HistoryArchiveWorkerStatusRepository)
		private readonly workerStatusRepository: HistoryArchiveWorkerStatusRepository
	) {}

	async execute(): Promise<Result<WorkerStatusDTO, Error>> {
		const generatedAt = new Date();
		const staleCutoff = new Date(
			generatedAt.getTime() - archiveObjectWorkerStaleAgeMs
		);
		const publicCutoff = new Date(
			generatedAt.getTime() - archiveObjectWorkerPublicRetentionMs
		);
		const pruneBefore = new Date(
			generatedAt.getTime() - archiveObjectWorkerStorageRetentionMs
		);

		try {
			const [queueSnapshot, workerRows, scannerMetricsResult] =
				await Promise.all([
					this.objectRepository.getWorkerSnapshot(staleCutoff),
					this.workerStatusRepository.findRecent({
						limit: archiveObjectWorkerRowLimit,
						observedAfter: publicCutoff,
						pruneBefore
					}),
					this.getScannerMetrics.execute()
				]);
			if (scannerMetricsResult.isErr()) return err(scannerMetricsResult.error);

			const workerStatus = this.mapArchiveWorkerStatus(
				workerRows,
				queueSnapshot,
				generatedAt,
				staleCutoff
			);
			const scannerStatus = this.mapCommunityScannerStatus(
				scannerMetricsResult.value
			);

			return ok({
				generatedAt: generatedAt.toISOString(),
				status: getWorstStatus([workerStatus.status, scannerStatus.status]),
				archiveWorkers: workerStatus,
				communityScanners: scannerStatus
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	private mapArchiveWorkerStatus(
		rows: readonly HistoryArchiveWorkerStatus[],
		queueSnapshot: {
			readonly activeObjects: number;
			readonly hasPendingObjects: boolean;
			readonly staleObjects: number;
			readonly totalScanningObjects: number;
		},
		generatedAt: Date,
		staleCutoff: Date
	): ArchiveWorkerStatusDTO {
		const configuredWorkerProcesses = readConfiguredObjectWorkerProcesses(
			process.env
		);
		const slotRows = selectLatestWorkerSlots(rows, configuredWorkerProcesses);
		const workers = slotRows
			.map((row) => this.mapArchiveWorker(row, generatedAt, staleCutoff))
			.sort(compareArchiveWorkers);
		const registeredActiveWorkers = workers.filter(
			(worker) => worker.status === 'active'
		).length;
		const idleWorkers = workers.filter(
			(worker) => worker.status === 'idle'
		).length;
		const registryStaleWorkers = workers.filter(
			(worker) => worker.status === 'stale'
		).length;
		const freshWorkers = registeredActiveWorkers + idleWorkers;
		const missingWorkers = Math.max(
			configuredWorkerProcesses - freshWorkers,
			0
		);
		const activeWorkers = Math.max(
			registeredActiveWorkers,
			queueSnapshot.activeObjects
		);
		const staleWorkers = Math.max(
			registryStaleWorkers,
			queueSnapshot.staleObjects
		);
		const startupGraceActive = this.isStartupGraceActive(
			slotRows,
			freshWorkers,
			missingWorkers,
			generatedAt,
			staleCutoff
		);
		const hasRuntimeSignal =
			freshWorkers > 0 || queueSnapshot.activeObjects > 0;
		const status: StatusLevel =
			missingWorkers === 0 && staleWorkers === 0
				? 'ok'
				: freshWorkers === 0 && !startupGraceActive && !hasRuntimeSignal
					? 'unavailable'
					: 'degraded';

		return {
			status,
			activeWorkers,
			configuredWorkerProcesses,
			freshWorkers,
			idleWorkers,
			lastHeartbeatAt: getLatestHeartbeat(slotRows),
			missingWorkers,
			queueActiveWorkers: queueSnapshot.activeObjects,
			queueStaleWorkers: queueSnapshot.staleObjects,
			registeredWorkers: workers.length,
			startupGraceActive,
			startupGraceMs: archiveObjectWorkerStartupGraceMs,
			staleWorkers,
			telemetryMode: 'per-worker',
			totalTakenJobs: Math.max(
				workers.filter((worker) => worker.currentObject !== null).length,
				queueSnapshot.totalScanningObjects
			),
			staleJobAgeMs: archiveObjectWorkerStaleAgeMs,
			workers
		};
	}

	private mapArchiveWorker(
		row: HistoryArchiveWorkerStatus,
		generatedAt: Date,
		staleCutoff: Date
	): ArchiveWorkerRowDTO {
		const stale = row.heartbeatAt < staleCutoff;
		return {
			bytesDownloaded: row.bytesDownloaded,
			bytesTotal: row.bytesTotal,
			claimAttempt: row.claimAttempt,
			currentObject:
				row.currentObject === null
					? null
					: {
							...row.currentObject,
							source: redactArchiveSource(row.currentObject.source)
						},
			heartbeatAgeMs: Math.max(
				0,
				generatedAt.getTime() - row.heartbeatAt.getTime()
			),
			lastHeartbeatAt: row.heartbeatAt.toISOString(),
			lastOutcome: row.lastOutcome,
			lastOutcomeAt: row.lastOutcomeAt?.toISOString() ?? null,
			pid: row.pid,
			processGeneration: row.processGeneration,
			processId: row.processId,
			processStartedAt: row.processStartedAt.toISOString(),
			slotIndex: row.slotIndex,
			stage: row.stage,
			status: stale ? 'stale' : row.currentObject === null ? 'idle' : 'active',
			workerId: row.workerId
		};
	}

	private isStartupGraceActive(
		rows: readonly HistoryArchiveWorkerStatus[],
		freshWorkers: number,
		missingWorkers: number,
		generatedAt: Date,
		staleCutoff: Date
	): boolean {
		if (missingWorkers === 0) return false;
		if (process.uptime() * 1000 < archiveObjectWorkerStartupGraceMs)
			return true;
		if (freshWorkers === 0) return false;

		return rows.some(
			(row) =>
				row.heartbeatAt >= staleCutoff &&
				generatedAt.getTime() - row.processStartedAt.getTime() <
					archiveObjectWorkerStartupGraceMs
		);
	}

	private mapCommunityScannerStatus(value: {
		readonly totalScanners: number;
		readonly activeScanners: number;
		readonly offlineScanners: number;
		readonly degradedScanners: number;
		readonly blacklistedScanners: number;
		readonly heartbeatFreshnessMs: number;
	}): CommunityScannerStatusDTO {
		return {
			status:
				value.degradedScanners > 0 || value.blacklistedScanners > 0
					? 'degraded'
					: 'ok',
			totalScanners: value.totalScanners,
			activeScanners: value.activeScanners,
			offlineScanners: value.offlineScanners,
			degradedScanners: value.degradedScanners,
			blacklistedScanners: value.blacklistedScanners,
			heartbeatFreshnessMs: value.heartbeatFreshnessMs
		};
	}
}

function redactArchiveSource(value: string): string {
	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return 'redacted';
		}
		return url.origin;
	} catch {
		return 'redacted';
	}
}

function compareArchiveWorkers(
	left: ArchiveWorkerRowDTO,
	right: ArchiveWorkerRowDTO
): number {
	const slotDifference = left.slotIndex - right.slotIndex;
	if (slotDifference !== 0) return slotDifference;
	const statusRank = { active: 0, idle: 1, stale: 2 } as const;
	const difference = statusRank[left.status] - statusRank[right.status];
	if (difference !== 0) return difference;
	const ageDifference = left.heartbeatAgeMs - right.heartbeatAgeMs;
	if (ageDifference !== 0) return ageDifference;
	return left.workerId.localeCompare(right.workerId);
}

function selectLatestWorkerSlots(
	rows: readonly HistoryArchiveWorkerStatus[],
	configuredWorkerProcesses: number
): HistoryArchiveWorkerStatus[] {
	const rowsBySlot = new Map<number, HistoryArchiveWorkerStatus>();
	for (const row of rows) {
		if (row.slotIndex >= configuredWorkerProcesses) continue;
		const current = rowsBySlot.get(row.slotIndex);
		if (current === undefined || isNewerWorkerReport(row, current)) {
			rowsBySlot.set(row.slotIndex, row);
		}
	}
	return Array.from(rowsBySlot.values());
}

function isNewerWorkerReport(
	candidate: HistoryArchiveWorkerStatus,
	current: HistoryArchiveWorkerStatus
): boolean {
	const heartbeatDifference =
		candidate.heartbeatAt.getTime() - current.heartbeatAt.getTime();
	if (heartbeatDifference !== 0) return heartbeatDifference > 0;
	const startDifference =
		candidate.processStartedAt.getTime() - current.processStartedAt.getTime();
	if (startDifference !== 0) return startDifference > 0;
	if (candidate.processGeneration !== current.processGeneration) {
		return candidate.processGeneration > current.processGeneration;
	}
	if (candidate.processId !== current.processId) {
		return candidate.processId > current.processId;
	}
	return candidate.sequence > current.sequence;
}

function getLatestHeartbeat(
	rows: readonly HistoryArchiveWorkerStatus[]
): string | null {
	let latest: Date | null = null;
	for (const row of rows) {
		if (latest === null || row.heartbeatAt > latest) latest = row.heartbeatAt;
	}
	return latest?.toISOString() ?? null;
}

function readConfiguredObjectWorkerProcesses(env: NodeJS.ProcessEnv): number {
	const rawValue = env.HISTORY_OBJECT_WORKER_PROCESSES;
	if (rawValue === undefined || rawValue.trim() === '') {
		return defaultConfiguredObjectWorkers;
	}

	const parsed = Number(rawValue);
	if (
		!Number.isInteger(parsed) ||
		parsed < 1 ||
		parsed > maxConfiguredObjectWorkers
	) {
		return defaultConfiguredObjectWorkers;
	}

	return parsed;
}
