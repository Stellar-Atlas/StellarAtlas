import { Scanner } from '../../domain/scanner/Scanner.js';
import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { HistoryArchiveStateValidator } from '../../domain/history-archive/HistoryArchiveStateValidator.js';
import { CheckPointGenerator } from '../../domain/check-point/CheckPointGenerator.js';
import type { CheckPointFrequency } from '../../domain/check-point/CheckPointFrequency.js';
import { TYPES } from './di-types.js';
import { StandardCheckPointFrequency } from '../../domain/check-point/StandardCheckPointFrequency.js';
import { CategoryScanner } from '../../domain/scanner/CategoryScanner.js';
import { BucketScanner } from '../../domain/scanner/BucketScanner.js';
import { BucketCache } from '../../domain/scanner/BucketCache.js';
import { RangeScanner } from '../../domain/scanner/RangeScanner.js';
import { VerifyArchives } from '../../use-cases/verify-archives/VerifyArchives.js';
import { VerifyArchiveObjects } from '../../use-cases/verify-archive-objects/VerifyArchiveObjects.js';
import { ArchivePerformanceTester } from '../../domain/scanner/ArchivePerformanceTester.js';
import { ScanSettingsFactory } from '../../domain/scan/ScanSettingsFactory.js';
import { CategoryVerificationService } from '../../domain/scanner/CategoryVerificationService.js';
import { Config } from '../config/Config.js';
import { AxiosHttpService, HttpQueue, type HttpService } from 'http-helper';
import type { ScanCoordinatorService } from '../../domain/scan/ScanCoordinatorService.js';
import { RESTScanCoordinatorService } from '../services/RESTScanCoordinatorService.js';
import {
	type JobMonitor,
	LoggerJobMonitor,
	SentryJobMonitor
} from 'job-monitor';
import {
	ConsoleExceptionLogger,
	SentryExceptionLogger
} from 'exception-logger';
import type { ExceptionLogger } from 'exception-logger';
import { PinoLogger } from 'logger';
import type { Logger } from 'logger';
import { VerifySingleArchive } from '../../use-cases/verify-single-archive/VerifySingleArchive.js';

export function load(container: Container, config: Config) {
	container.bind(CategoryScanner).toSelf();
	container
		.bind<number>(TYPES.ScanWorkerCount)
		.toConstantValue(config.historyScanWorkers);
	container
		.bind<number>(TYPES.HasherWorkerCount)
		.toConstantValue(config.historyHasherWorkers);
	container.bind(BucketCache).toDynamicValue(() => {
		return new BucketCache(
			config.historyBucketCacheDir,
			config.historyBucketCacheMaxBytes,
			container.get<Logger>('Logger')
		);
	});
	container.bind(BucketScanner).toDynamicValue(() => {
		return new BucketScanner(
			container.get<HttpQueue>(TYPES.HttpQueue),
			container.get(BucketCache)
		);
	});
	container.bind(HistoryArchiveStateValidator).toSelf();
	container
		.bind(Scanner)
		.toDynamicValue(() => {
			return new Scanner(
				container.get(RangeScanner),
				container.get(ScanSettingsFactory),
				container.get<Logger>('Logger'),
				container.get<ExceptionLogger>(TYPES.ExceptionLogger),
				config.historyScanRangeSize
			);
		})
		.inSingletonScope();
	container.bind(RangeScanner).toSelf();
	container.bind(VerifyArchives).toSelf();
	container.bind(VerifyArchiveObjects).toSelf();
	container.bind(VerifySingleArchive).toSelf();
	container.bind(CheckPointGenerator).toSelf();
	container.bind(CategoryVerificationService).toSelf();
	container.bind(ScanSettingsFactory).toDynamicValue(() => {
		return new ScanSettingsFactory(
			container.get(CategoryScanner),
			container.get(ArchivePerformanceTester),
			config.historySlowArchiveMaxLedgers,
			config.historyMaxRequests,
			config.historyMaxRequests
		);
	});
	container
		.bind(ArchivePerformanceTester)
		.toDynamicValue(
			() =>
				new ArchivePerformanceTester(
					container.get(CheckPointGenerator),
					container.get<HttpQueue>(TYPES.HttpQueue),
					config.historyMaxFileMs
				)
		);
	container
		.bind<CheckPointFrequency>(TYPES.CheckPointFrequency)
		.toDynamicValue(() => {
			return new StandardCheckPointFrequency();
		});
	container
		.bind<ScanCoordinatorService>(TYPES.ScanCoordinatorService)
		.toDynamicValue(() => {
			return new RESTScanCoordinatorService(
				container.get<HttpService>(TYPES.HttpService),
				config.coordinatorAPIBaseUrl,
				config.coordinatorAuth
			);
		});
	container.bind<ExceptionLogger>(TYPES.ExceptionLogger).toDynamicValue(() => {
		if (config.enableSentry && config.sentryDSN)
			return new SentryExceptionLogger(
				config.sentryDSN,
				container.get<Logger>('Logger')
			);
		else return new ConsoleExceptionLogger();
	});
	container
		.bind<Logger>('Logger')
		.toDynamicValue(() => {
			return new PinoLogger(config.logLevel);
		})
		.inSingletonScope();
	container.bind<JobMonitor>(TYPES.JobMonitor).toDynamicValue(() => {
		if (config.enableSentry && config.sentryDSN)
			return new SentryJobMonitor(config.sentryDSN);
		return new LoggerJobMonitor(container.get<Logger>('Logger'));
	});
	container.bind<HttpService>(TYPES.HttpService).toDynamicValue(() => {
		return new AxiosHttpService(config.userAgent);
	});

	container.bind<HttpQueue>(TYPES.HttpQueue).toDynamicValue(() => {
		return new HttpQueue(
			container.get<HttpService>(TYPES.HttpService),
			container.get<Logger>('Logger')
		);
	});
}
