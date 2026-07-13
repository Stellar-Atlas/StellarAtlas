import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export interface ArchiveQueueStatusDTO {
	readonly deprecated: true;
	readonly drivesPlatformStatus: false;
	readonly drivesRuntimeHealth: false;
	readonly generatedAt: string;
	readonly historical: true;
	readonly source: 'legacy_range_scan';
	readonly status: StatusLevel;
	readonly pendingJobs: number;
	readonly activeJobs: number;
	readonly staleJobs: number;
	readonly totalUnfinishedJobs: number;
	readonly staleJobAgeMs: number;
}

@injectable()
export class GetArchiveQueueStatus {
	constructor(
		@inject(GetArchiveScanQueue)
		private readonly getArchiveScanQueue: GetArchiveScanQueue
	) {}

	async execute(): Promise<Result<ArchiveQueueStatusDTO, Error>> {
		const queueResult = await this.getArchiveScanQueue.execute();
		if (queueResult.isErr()) return err(queueResult.error);

		const queue = queueResult.value;
		return ok({
			deprecated: true,
			drivesPlatformStatus: false,
			drivesRuntimeHealth: false,
			generatedAt: queue.generatedAt,
			historical: true,
			source: 'legacy_range_scan',
			status: queue.staleJobs > 0 ? 'degraded' : 'ok',
			pendingJobs: queue.pendingJobs,
			activeJobs: queue.activeJobs,
			staleJobs: queue.staleJobs,
			totalUnfinishedJobs: queue.totalUnfinishedJobs,
			staleJobAgeMs: queue.staleJobAgeMs
		});
	}
}
