import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import { getWorstStatus, type StatusLevel } from '../../domain/StatusTypes.js';
import type { ArchiveQueueStatusDTO } from '../get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetArchiveQueueStatus } from '../get-archive-queue-status/GetArchiveQueueStatus.js';
import type { DataFreshnessStatusDTO } from '../get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetDataFreshnessStatus } from '../get-data-freshness-status/GetDataFreshnessStatus.js';
import type { RollupStatusDTO } from '../get-rollup-status/GetRollupStatus.js';
import { GetRollupStatus } from '../get-rollup-status/GetRollupStatus.js';
import type { ScanStatusDTO } from '../get-scan-status/GetScanStatus.js';
import { GetScanStatus } from '../get-scan-status/GetScanStatus.js';

export interface DataQualityStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly dataFreshness: DataFreshnessStatusDTO;
	readonly scans: ScanStatusDTO;
	readonly rollups: RollupStatusDTO;
	readonly archiveQueue: ArchiveQueueStatusDTO;
}

@injectable()
export class GetDataQualityStatus {
	constructor(
		@inject(GetDataFreshnessStatus)
		private readonly getDataFreshnessStatus: GetDataFreshnessStatus,
		@inject(GetScanStatus)
		private readonly getScanStatus: GetScanStatus,
		@inject(GetRollupStatus)
		private readonly getRollupStatus: GetRollupStatus,
		@inject(GetArchiveQueueStatus)
		private readonly getArchiveQueueStatus: GetArchiveQueueStatus
	) {}

	async execute(): Promise<Result<DataQualityStatusDTO, Error>> {
		const [dataFreshnessResult, scanResult, rollupResult, archiveQueueResult] =
			await Promise.all([
				this.getDataFreshnessStatus.execute(),
				this.getScanStatus.execute(),
				this.getRollupStatus.execute(),
				this.getArchiveQueueStatus.execute()
			]);

		if (dataFreshnessResult.isErr()) return err(dataFreshnessResult.error);
		if (scanResult.isErr()) return err(scanResult.error);
		if (rollupResult.isErr()) return err(rollupResult.error);
		if (archiveQueueResult.isErr()) return err(archiveQueueResult.error);

		const dataFreshness = dataFreshnessResult.value;
		const scans = scanResult.value;
		const rollups = rollupResult.value;
		const archiveQueue = archiveQueueResult.value;

		return ok({
			generatedAt: new Date().toISOString(),
			status: getWorstStatus([
				dataFreshness.status,
				scans.status,
				rollups.status,
				archiveQueue.status
			]),
			dataFreshness,
			scans,
			rollups,
			archiveQueue
		});
	}
}
