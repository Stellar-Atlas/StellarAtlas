import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { getWorstStatus, type StatusLevel } from '../../domain/StatusTypes.js';

export interface ArchiveWorkerStatusDTO {
	readonly status: StatusLevel;
	readonly activeWorkers: number;
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
		@inject(GetArchiveScanWorkers)
		private readonly getArchiveScanWorkers: GetArchiveScanWorkers,
		@inject(GetScannerMetrics)
		private readonly getScannerMetrics: GetScannerMetrics
	) {}

	async execute(): Promise<Result<WorkerStatusDTO, Error>> {
		const [workersResult, scannerMetricsResult] = await Promise.all([
			this.getArchiveScanWorkers.execute(),
			this.getScannerMetrics.execute()
		]);
		if (workersResult.isErr()) return err(workersResult.error);
		if (scannerMetricsResult.isErr()) return err(scannerMetricsResult.error);

		const workerStatus = this.mapArchiveWorkerStatus(workersResult.value);
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
		readonly staleWorkers: number;
		readonly activeWorkers: number;
		readonly totalTakenJobs: number;
		readonly staleJobAgeMs: number;
	}): ArchiveWorkerStatusDTO {
		return {
			status: value.staleWorkers > 0 ? 'degraded' : 'ok',
			activeWorkers: value.activeWorkers,
			staleWorkers: value.staleWorkers,
			totalTakenJobs: value.totalTakenJobs,
			staleJobAgeMs: value.staleJobAgeMs
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
