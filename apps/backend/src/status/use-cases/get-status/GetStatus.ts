import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import {
	getWorstStatus,
	type ApiStatusDTO,
	type StatusLevel
} from '../../domain/StatusTypes.js';
import type { ArchiveQueueStatusDTO } from '../get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetArchiveQueueStatus } from '../get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '../get-api-status/GetApiStatus.js';
import type { DataFreshnessStatusDTO } from '../get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetDataFreshnessStatus } from '../get-data-freshness-status/GetDataFreshnessStatus.js';
import type { WorkerStatusDTO } from '../get-worker-status/GetWorkerStatus.js';
import { GetWorkerStatus } from '../get-worker-status/GetWorkerStatus.js';

export interface StatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly api: ApiStatusDTO;
	readonly dataFreshness: DataFreshnessStatusDTO;
	readonly archiveQueue: ArchiveQueueStatusDTO;
	readonly workers: WorkerStatusDTO;
}

@injectable()
export class GetStatus {
	constructor(
		@inject(GetApiStatus) private readonly getApiStatus: GetApiStatus,
		@inject(GetDataFreshnessStatus)
		private readonly getDataFreshnessStatus: GetDataFreshnessStatus,
		@inject(GetArchiveQueueStatus)
		private readonly getArchiveQueueStatus: GetArchiveQueueStatus,
		@inject(GetWorkerStatus) private readonly getWorkerStatus: GetWorkerStatus
	) {}

	async execute(): Promise<Result<StatusDTO, Error>> {
		const apiResult = this.getApiStatus.execute();
		const [dataFreshnessResult, archiveQueueResult, workerResult] =
			await Promise.all([
				this.getDataFreshnessStatus.execute(),
				this.getArchiveQueueStatus.execute(),
				this.getWorkerStatus.execute()
			]);

		if (apiResult.isErr()) return err(apiResult.error);
		if (dataFreshnessResult.isErr()) return err(dataFreshnessResult.error);
		if (archiveQueueResult.isErr()) return err(archiveQueueResult.error);
		if (workerResult.isErr()) return err(workerResult.error);

		const api = apiResult.value;
		const dataFreshness = dataFreshnessResult.value;
		const archiveQueue = archiveQueueResult.value;
		const workers = workerResult.value;

		return ok({
			generatedAt: new Date().toISOString(),
			status: getWorstStatus([
				api.status,
				dataFreshness.status,
				archiveQueue.status,
				workers.status
			]),
			api,
			dataFreshness,
			archiveQueue,
			workers
		});
	}
}
