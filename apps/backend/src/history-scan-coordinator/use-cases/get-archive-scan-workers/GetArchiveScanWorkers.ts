import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanJob } from '../../domain/ScanJob.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import {
	getStaleScanJobCutoff,
	staleScanJobAgeMs
} from '../../domain/ScanJobStaleness.js';
import { TYPES } from '../../infrastructure/di/di-types.js';

export type ArchiveScanWorkerStatus = 'scanning' | 'starting' | 'stale';

export interface ArchiveScanWorkerDTO {
	readonly archiveUrl: string;
	readonly status: ArchiveScanWorkerStatus;
	readonly claimedAt: string;
	readonly lastHeartbeatAt: string;
	readonly heartbeatAgeMs: number;
	readonly fromLedger: number;
	readonly currentRangeFromLedger: number | null;
	readonly currentRangeToLedger: number | null;
	readonly toLedger: number | null;
	readonly latestAttemptedLedger: number | null;
	readonly latestScannedLedger: number;
	readonly concurrency: number | null;
}

export interface ArchiveScanWorkersDTO {
	readonly generatedAt: string;
	readonly staleJobAgeMs: number;
	readonly activeWorkers: number;
	readonly staleWorkers: number;
	readonly totalTakenJobs: number;
	readonly workers: readonly ArchiveScanWorkerDTO[];
}

@injectable()
export class GetArchiveScanWorkers {
	private static readonly maxWorkers = 50;
	private static readonly maxVisibleConcurrency = 24;

	constructor(
		@inject(TYPES.ScanJobRepository)
		private scanJobRepository: ScanJobRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<ArchiveScanWorkersDTO, Error>> {
		const generatedAt = new Date();
		const staleCutoff = getStaleScanJobCutoff(generatedAt);

		try {
			const snapshot = await this.scanJobRepository.getTakenJobsSnapshot(
				staleCutoff,
				GetArchiveScanWorkers.maxWorkers
			);

			return ok({
				generatedAt: generatedAt.toISOString(),
				staleJobAgeMs: staleScanJobAgeMs,
				activeWorkers: snapshot.activeTakenJobs,
				staleWorkers: snapshot.staleTakenJobs,
				totalTakenJobs: snapshot.totalTakenJobs,
				workers: snapshot.jobs.map((job) =>
					this.mapTakenJob(job, generatedAt, staleCutoff)
				)
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private mapTakenJob(
		job: ScanJob,
		generatedAt: Date,
		staleCutoff: Date
	): ArchiveScanWorkerDTO {
		const lastHeartbeatAt = job.updatedAt ?? generatedAt;
		const claimedAt = job.claimedAt ?? job.createdAt ?? lastHeartbeatAt;

		return {
			archiveUrl: job.url,
			status: this.mapWorkerStatus(job, lastHeartbeatAt, staleCutoff),
			claimedAt: claimedAt.toISOString(),
			lastHeartbeatAt: lastHeartbeatAt.toISOString(),
			heartbeatAgeMs: Math.max(
				0,
				generatedAt.getTime() - lastHeartbeatAt.getTime()
			),
			fromLedger:
				job.fromLedger ??
				(job.latestScannedLedger > 0 ? job.latestScannedLedger + 1 : 0),
			currentRangeFromLedger: job.currentRangeFromLedger,
			currentRangeToLedger: job.currentRangeToLedger,
			toLedger: job.toLedger,
			latestAttemptedLedger: job.latestAttemptedLedger,
			latestScannedLedger: job.latestScannedLedger,
			concurrency: this.mapVisibleConcurrency(job.concurrency)
		};
	}

	private mapVisibleConcurrency(concurrency: number | null): number | null {
		if (concurrency === null) return null;

		return Math.min(concurrency, GetArchiveScanWorkers.maxVisibleConcurrency);
	}

	private mapWorkerStatus(
		job: ScanJob,
		lastHeartbeatAt: Date,
		staleCutoff: Date
	): ArchiveScanWorkerStatus {
		if (lastHeartbeatAt < staleCutoff) return 'stale';
		if (job.concurrency === null || job.concurrency <= 0) return 'starting';
		return 'scanning';
	}
}
