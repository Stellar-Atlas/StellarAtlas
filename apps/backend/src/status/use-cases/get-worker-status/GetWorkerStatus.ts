import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { getWorstStatus, type StatusLevel } from '../../domain/StatusTypes.js';

const archiveObjectWorkerStaleAgeMs = 2 * 60 * 1000;
const defaultConfiguredObjectWorkers = 24;
const maxConfiguredObjectWorkers = 24;

export interface ArchiveWorkerStatusDTO {
	readonly status: StatusLevel;
	readonly activeWorkers: number;
	readonly configuredWorkerProcesses: number;
	readonly staleWorkers: number;
	readonly totalTakenJobs: number;
	readonly staleJobAgeMs: number;
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
		private readonly objectRepository: HistoryArchiveObjectRepository
	) {}

	async execute(): Promise<Result<WorkerStatusDTO, Error>> {
		const staleCutoff = new Date(Date.now() - archiveObjectWorkerStaleAgeMs);
		const [workerSnapshot, scannerMetricsResult] = await Promise.all([
			this.objectRepository.getWorkerSnapshot(staleCutoff).catch((error) => {
				throw mapUnknownToError(error);
			}),
			this.getScannerMetrics.execute()
		]).catch((error: unknown) => {
			return [null, err(mapUnknownToError(error))] as const;
		});
		if (workerSnapshot === null) return err(scannerMetricsResult.error);
		if (scannerMetricsResult.isErr()) return err(scannerMetricsResult.error);

		const workerStatus = this.mapArchiveWorkerStatus(workerSnapshot);
		const scannerStatus = this.mapCommunityScannerStatus(
			scannerMetricsResult.value
		);

		return ok({
			generatedAt: new Date().toISOString(),
			status: getWorstStatus([workerStatus.status, scannerStatus.status]),
			archiveWorkers: workerStatus,
			communityScanners: scannerStatus
		});
	}

	private mapArchiveWorkerStatus(value: {
		readonly activeObjects: number;
		readonly hasPendingObjects: boolean;
		readonly staleObjects: number;
		readonly totalScanningObjects: number;
	}): ArchiveWorkerStatusDTO {
		const stalledWithBacklog =
			value.hasPendingObjects && value.activeObjects === 0;
		return {
			status:
				value.staleObjects > 0 || stalledWithBacklog ? 'degraded' : 'ok',
			activeWorkers: value.activeObjects,
			configuredWorkerProcesses: readConfiguredObjectWorkerProcesses(
				process.env
			),
			staleWorkers: value.staleObjects,
			totalTakenJobs: value.totalScanningObjects,
			staleJobAgeMs: archiveObjectWorkerStaleAgeMs
		};
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
