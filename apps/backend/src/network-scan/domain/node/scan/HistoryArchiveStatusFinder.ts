import { injectable } from 'inversify';
import { HistoryService } from './history/HistoryService.js';
import { queue } from 'async';
import { historyArchiveScanEnabled } from 'shared';

@injectable()
export class HistoryArchiveStatusFinder {
	protected historyService: HistoryService;

	constructor(historyService: HistoryService) {
		this.historyService = historyService;
	}

	async getNodesWithUpToDateHistoryArchives(
		publicKeyToHistoryArchiveMap: Map<string, string>,
		latestLedger: bigint
	): Promise<Set<string>> {
		const upToDateNodes = new Set<string>();
		const q = queue(
			async (record: { publicKey: string; url: string }, callback) => {
				const upToDate = await this.historyService.stellarHistoryIsUpToDate(
					record.url,
					latestLedger.toString()
				);
				if (upToDate) upToDateNodes.add(record.publicKey);
				callback();
			},
			10
		);

		publicKeyToHistoryArchiveMap.forEach((historyArchiveUrl, publicKey) => {
			// Skip before HTTP work. Absence is not a successful archive check,
			// and the stored historical evidence is left untouched.
			if (!historyArchiveScanEnabled(historyArchiveUrl)) return;
			q.push({
				publicKey: publicKey,
				url: historyArchiveUrl
			});
		});

		if (q.length() === 0) return upToDateNodes;

		await q.drain();

		return upToDateNodes;
	}
}
