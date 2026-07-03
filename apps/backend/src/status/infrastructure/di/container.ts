import type { Config } from '@core/config/Config.js';
import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { GetArchiveQueueStatus } from '../../use-cases/get-archive-queue-status/GetArchiveQueueStatus.js';
import { GetApiStatus } from '../../use-cases/get-api-status/GetApiStatus.js';
import { GetDataQualityStatus } from '../../use-cases/get-data-quality-status/GetDataQualityStatus.js';
import { GetDataFreshnessStatus } from '../../use-cases/get-data-freshness-status/GetDataFreshnessStatus.js';
import { GetRollupStatus } from '../../use-cases/get-rollup-status/GetRollupStatus.js';
import { GetScanStatus } from '../../use-cases/get-scan-status/GetScanStatus.js';
import {
	GetFailoverStatus,
	GetFrontendStatus,
	GetHorizonStatus,
	GetRpcStatus
} from '../../use-cases/get-service-status/GetServiceStatus.js';
import { GetStatus } from '../../use-cases/get-status/GetStatus.js';
import { GetWorkerStatus } from '../../use-cases/get-worker-status/GetWorkerStatus.js';

export function load(container: Container, config: Config) {
	if (!container.isBound('Config')) {
		container.bind<Config>('Config').toConstantValue(config);
	}

	container.bind(GetApiStatus).toSelf();
	container.bind(GetDataQualityStatus).toSelf();
	container.bind(GetDataFreshnessStatus).toSelf();
	container.bind(GetScanStatus).toSelf();
	container.bind(GetRollupStatus).toSelf();
	container.bind(GetFrontendStatus).toSelf();
	container.bind(GetHorizonStatus).toSelf();
	container.bind(GetRpcStatus).toSelf();
	container.bind(GetFailoverStatus).toSelf();
	container.bind(GetArchiveQueueStatus).toSelf();
	container.bind(GetWorkerStatus).toSelf();
	container.bind(GetStatus).toSelf();
}
