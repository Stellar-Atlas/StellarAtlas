import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { DataSource } from 'typeorm';
import type { ScanRepository } from '../../domain/scan/ScanRepository.js';
import { TypeOrmHistoryArchiveScanResultRepository } from '../repositories/database/TypeOrmHistoryArchiveScanResultRepository.js';
import { TYPES } from './di-types.js';
import { Config } from '@core/config/Config.js';
import { GetLatestScan } from '../../use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '../../use-cases/get-scan-logs/GetScanLogs.js';
import { GetScanEvidence } from '../../use-cases/get-scan-evidence/GetScanEvidence.js';
import { Scan } from '../../domain/scan/Scan.js';
import { RegisterScan } from '../../use-cases/register-scan/RegisterScan.js';
import { ScanMapper } from '../mappers/ScanMapper.js';
import { GetScanJob } from '../../use-cases/get-scan-job/GetScanJob.js';
import { ReleaseScanJob } from '../../use-cases/release-scan-job/ReleaseScanJob.js';
import { TouchScanJob } from '../../use-cases/touch-scan-job/TouchScanJob.js';
import { RestartAtLeastOneScan } from '../../domain/ScanScheduler.js';
import type { ScanScheduler } from '../../domain/ScanScheduler.js';
import { ScheduleScanJobs } from '../../use-cases/schedule-scan-jobs/ScheduleScanJobs.js';
import type { ScanJobRepository } from '../../domain/ScanJobRepository.js';
import { TypeOrmScanJobRepository } from '../repositories/database/TypeOrmScanJobRepository.js';
import { ScanJob } from '../../domain/ScanJob.js';
import { GetArchiveScans } from '../../use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '../../use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '../../use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { CommunityScanner } from '../database/entities/CommunityScanner.js';
import { GetScannerMetrics } from '../../use-cases/GetScannerMetrics.js';
import { RegisterCommunityScanner } from '../../use-cases/RegisterCommunityScanner.js';
import { SendScannerHeartbeat } from '../../use-cases/SendScannerHeartbeat.js';
import type { CommunityScannerRegistrationThrottleRepository } from '../../domain/CommunityScannerRegistrationThrottle.js';
import { TypeOrmCommunityScannerRegistrationThrottleRepository } from '../repositories/database/TypeOrmCommunityScannerRegistrationThrottleRepository.js';
import { RegisterParsedLedgerHeaders } from '../../use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import type { ParsedLedgerHeaderRepository } from '../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { TypeOrmParsedLedgerHeaderRepository } from '../repositories/database/TypeOrmParsedLedgerHeaderRepository.js';
import { ParsedLedgerHeader } from '../database/entities/ParsedLedgerHeader.js';
import { BackfillArchiveMetadata } from '../../use-cases/backfill-archive-metadata/BackfillArchiveMetadata.js';

export function load(container: Container, config: Config) {
	const dataSource = container.get(DataSource);
	container.bind(GetLatestScan).toSelf();
	container.bind(GetScanLogs).toSelf();
	container.bind(GetScanEvidence).toSelf();
	container.bind(GetScanJob).toSelf();
	container.bind(GetArchiveScans).toSelf();
	container.bind(GetArchiveScanQueue).toSelf();
	container.bind(GetArchiveScanWorkers).toSelf();
	container.bind(GetScannerMetrics).toSelf();
	container.bind(BackfillArchiveMetadata).toSelf();
	container.bind(RegisterCommunityScanner).toSelf();
	container.bind(SendScannerHeartbeat).toSelf();
	container.bind(TouchScanJob).toSelf();
	container.bind(ReleaseScanJob).toSelf();
	container.bind(RegisterScan).toSelf();
	container.bind(RegisterParsedLedgerHeaders).toSelf();
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
		.bind(TYPES.CommunityScannerRepository)
		.toDynamicValue(() => {
			return dataSource.getRepository(CommunityScanner);
		})
		.inRequestScope();

	container
		.bind<CommunityScannerRegistrationThrottleRepository>(
			TYPES.CommunityScannerRegistrationThrottleRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmCommunityScannerRegistrationThrottleRepository(
				dataSource
			);
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

	container
		.bind<ParsedLedgerHeaderRepository>(TYPES.ParsedLedgerHeaderRepository)
		.toDynamicValue(() => {
			return new TypeOrmParsedLedgerHeaderRepository(
				dataSource.getRepository(ParsedLedgerHeader)
			);
		})
		.inRequestScope();
}
