import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { DataSource } from 'typeorm';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { TypeOrmHistoryArchiveScanResultRepository } from '../repositories/database/TypeOrmHistoryArchiveScanResultRepository.js';
import { TYPES } from './di-types.js';
import { Config } from '../../../core/config/Config.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { Scan } from '../../domain/scan/Scan.js';
import { RegisterScan } from '../../use-cases/register-scan/RegisterScan.js';
import { ScanMapper } from '../mappers/ScanMapper.js';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { RestartAtLeastOneScan } from '../../domain/ScanScheduler.js';
import type { ScanScheduler } from '../../domain/ScanScheduler.js';
import { ScheduleScanJobs } from '../../use-cases/schedule-scan-jobs/ScheduleScanJobs.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { TypeOrmScanJobRepository } from '../repositories/database/TypeOrmScanJobRepository.js';
import { ScanJob } from '../../domain/ScanJob.js';

export function load(container: Container, config: Config) {
	const dataSource = container.get(DataSource);
	container.bind(GetLatestScan).toSelf();
	container.bind(GetScanJob).toSelf();
	container.bind(RegisterScan).toSelf();
	container.bind(ScheduleScanJobs).toSelf();
	container.bind<ScanScheduler>(TYPES.ScanScheduler).toDynamicValue(() => {
		return new RestartAtLeastOneScan();
	});
	container.bind(ScanMapper).toSelf();
	container
		.bind<ScanJobRepository>(TYPES.ScanJobRepository)
		.toDynamicValue(() => {
			return new TypeOrmScanJobRepository(dataSource.getRepository(ScanJob));
		})
		.inRequestScope();

	container
		.bind<ScanRepository>(TYPES.HistoryArchiveScanRepository)
		.toDynamicValue(() => {
			return new TypeOrmHistoryArchiveScanResultRepository(
				dataSource.getRepository(Scan)
			);
		})
		.inRequestScope();
}
