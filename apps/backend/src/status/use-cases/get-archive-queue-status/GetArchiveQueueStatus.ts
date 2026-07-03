import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export interface ArchiveQueueStatusDTO {
	readonly generatedAt: string;
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
			generatedAt: queue.generatedAt,
			status: queue.staleJobs > 0 ? 'degraded' : 'ok',
			pendingJobs: queue.pendingJobs,
			activeJobs: queue.activeJobs,
			staleJobs: queue.staleJobs,
			totalUnfinishedJobs: queue.totalUnfinishedJobs,
			staleJobAgeMs: queue.staleJobAgeMs
		});
	}
}
