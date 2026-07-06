import { HistoryArchiveStatusFinder } from './HistoryArchiveStatusFinder.js';
import { inject, injectable } from 'inversify';
import { NodeScan } from './NodeScan.js';
import type { HistoryArchiveScanService } from './history/HistoryArchiveScanService.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { Logger } from '@core/services/Logger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

@injectable()
export class NodeScannerHistoryArchiveStep {
	constructor(
		private historyArchiveStatusFinder: HistoryArchiveStatusFinder,
		@inject(NETWORK_TYPES.HistoryArchiveScanService)
		private historyArchiveScanService: HistoryArchiveScanService,
		@inject('Logger') private logger: Logger
	) {}

	public async execute(nodeScan: NodeScan): Promise<void> {
		nodeScan.updateHistoryArchiveUpToDateStatus(
			await this.historyArchiveStatusFinder.getNodesWithUpToDateHistoryArchives(
				nodeScan.getHistoryArchiveUrls(),
				nodeScan.latestLedger
			)
		);
		nodeScan.updateHistoryArchiveVerificationStatus(
			await this.historyArchiveStatusFinder.getNodesWithHistoryArchiveVerificationErrors(
				nodeScan.getHistoryArchiveUrls()
			)
		);

		const historyArchiveUrls = Array.from(
			nodeScan.getHistoryArchiveUrls().values()
		);
		try {
			const scheduleResult =
				await this.historyArchiveScanService.scheduleScans(historyArchiveUrls);
			if (scheduleResult.isErr()) {
				this.logger.error('History archive scan scheduling failed', {
					archiveUrlCount: historyArchiveUrls.length,
					errorMessage: scheduleResult.error.message
				});
				return;
			}

			this.logger.info('History archive scan scheduling completed', {
				archiveUrlCount: historyArchiveUrls.length
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.logger.error('History archive scan scheduling failed', {
				archiveUrlCount: historyArchiveUrls.length,
				errorMessage: mappedError.message
			});
		}
	}
}
