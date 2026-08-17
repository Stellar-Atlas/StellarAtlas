import type Kernel from '../Kernel.js';
import type { Config } from '../../config/Config.js';
import { historyScanRouter } from '@history-scan-coordinator/infrastructure/http/HistoryScanRouter.js';
import { BackfillArchiveMetadata } from '@history-scan-coordinator/use-cases/backfill-archive-metadata/BackfillArchiveMetadata.js';
import { CompleteHistoryArchiveObject } from '@history-scan-coordinator/use-cases/complete-history-archive-object/CompleteHistoryArchiveObject.js';
import { FailHistoryArchiveObject } from '@history-scan-coordinator/use-cases/fail-history-archive-object/FailHistoryArchiveObject.js';
import { GetHistoryArchiveContentReuse } from '@history-scan-coordinator/use-cases/get-history-archive-content-reuse/GetHistoryArchiveContentReuse.js';
import { GetHistoryArchiveObjectJob } from '@history-scan-coordinator/use-cases/get-history-archive-object-job/GetHistoryArchiveObjectJob.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';
import { RegisterParsedLedgerHeaders } from '@history-scan-coordinator/use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import { RegisterParsedTransactionEnvelopes } from '@history-scan-coordinator/use-cases/register-parsed-transaction-envelopes/RegisterParsedTransactionEnvelopes.js';
import { RegisterParsedTransactionResults } from '@history-scan-coordinator/use-cases/register-parsed-transaction-results/RegisterParsedTransactionResults.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';
import { ReleaseHistoryArchiveObject } from '@history-scan-coordinator/use-cases/release-history-archive-object/ReleaseHistoryArchiveObject.js';
import { ReleaseScanJob } from '@history-scan-coordinator/use-cases/release-scan-job/ReleaseScanJob.js';
import { ReportHistoryArchiveWorkerStatus } from '@history-scan-coordinator/use-cases/report-history-archive-worker-status/ReportHistoryArchiveWorkerStatus.js';
import { TouchHistoryArchiveObject } from '@history-scan-coordinator/use-cases/touch-history-archive-object/TouchHistoryArchiveObject.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';

export function createHistoryScanRouter(kernel: Kernel, config: Config) {
	return historyScanRouter({
		backfillArchiveMetadata: kernel.container.get(BackfillArchiveMetadata),
		completeHistoryArchiveObject: kernel.container.get(
			CompleteHistoryArchiveObject
		),
		failHistoryArchiveObject: kernel.container.get(FailHistoryArchiveObject),
		frontendBaseUrl: config.frontendBaseUrl,
		frontendRevalidateToken: config.frontendRevalidateToken,
		getHistoryArchiveContentReuse: kernel.container.get(
			GetHistoryArchiveContentReuse
		),
		getHistoryArchiveObjectJob: kernel.container.get(
			GetHistoryArchiveObjectJob
		),
		getLatestScan: kernel.container.get(GetLatestScan),
		getScanJob: kernel.container.get(GetScanJob),
		getScanLogs: kernel.container.get(GetScanLogs),
		password: config.historyScanAPIPassword,
		registerParsedLedgerHeaders: kernel.container.get(
			RegisterParsedLedgerHeaders
		),
		registerParsedTransactionEnvelopes: kernel.container.get(
			RegisterParsedTransactionEnvelopes
		),
		registerParsedTransactionResults: kernel.container.get(
			RegisterParsedTransactionResults
		),
		registerScan: kernel.container.get(RegisterScan),
		releaseHistoryArchiveObject: kernel.container.get(
			ReleaseHistoryArchiveObject
		),
		releaseScanJob: kernel.container.get(ReleaseScanJob),
		reportHistoryArchiveWorkerStatus: kernel.container.get(
			ReportHistoryArchiveWorkerStatus
		),
		touchHistoryArchiveObject: kernel.container.get(TouchHistoryArchiveObject),
		touchScanJob: kernel.container.get(TouchScanJob),
		userName: config.historyScanAPIUsername
	});
}
