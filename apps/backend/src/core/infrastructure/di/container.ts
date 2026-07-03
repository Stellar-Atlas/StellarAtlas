import type { Config } from '../../config/Config.js';
import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { PinoLogger } from 'logger';
import type { Logger } from 'logger';
import type { HttpService } from 'http-helper';
import { AxiosHttpService } from 'http-helper';
import type { HeartBeater } from '../../services/HeartBeater.js';
import { DeadManSnitchHeartBeater } from '@network-scan/infrastructure/services/DeadManSnitchHeartBeater.js';
import { DummyHeartBeater } from '@network-scan/infrastructure/services/DummyHeartBeater.js';
import { LoopTimer } from '../../services/LoopTimer.js';
import type { JobMonitor } from 'job-monitor';
import { CORE_TYPES } from './di-types.js';
import { SentryJobMonitor, LoggerJobMonitor } from 'job-monitor';
import {
	SentryExceptionLogger,
	ConsoleExceptionLogger
} from 'exception-logger';
import type { ExceptionLogger } from 'exception-logger';
import type { FrontendRevalidationConfig } from '../../services/FrontendRevalidation.js';

export function load(container: Container, config: Config) {
	container
		.bind<Logger>('Logger')
		.toDynamicValue(() => {
			return new PinoLogger(config.logLevel);
		})
		.inSingletonScope();
	container
		.bind<HttpService>('HttpService')
		.toDynamicValue(() => {
			return new AxiosHttpService(config.userAgent);
		})
		.inSingletonScope();

	container.bind<HeartBeater>('HeartBeater').toDynamicValue(() => {
		if (config.enableDeadManSwitch && config.deadManSwitchUrl)
			return new DeadManSnitchHeartBeater(
				container.get<HttpService>('HttpService'),
				config.deadManSwitchUrl
			);
		return new DummyHeartBeater();
	});

	container.bind<JobMonitor>(CORE_TYPES.JobMonitor).toDynamicValue(() => {
		if (config.enableSentry && config.sentryDSN)
			return new SentryJobMonitor(config.sentryDSN);
		return new LoggerJobMonitor(container.get<Logger>('Logger'));
	});

	container
		.bind<ExceptionLogger>('ExceptionLogger')
		.toDynamicValue(() => {
			if (config.enableSentry && config.sentryDSN)
				return new SentryExceptionLogger(
					config.sentryDSN,
					container.get<Logger>('Logger')
				);
			else return new ConsoleExceptionLogger();
		})
		.inSingletonScope();

	container
		.bind<FrontendRevalidationConfig>(CORE_TYPES.FrontendRevalidationConfig)
		.toConstantValue({
			frontendBaseUrl: config.frontendBaseUrl,
			frontendRevalidateToken: config.frontendRevalidateToken
		});

	container.bind(LoopTimer).toSelf();
}
