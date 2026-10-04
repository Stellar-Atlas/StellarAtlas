import { HistoryService } from '../history/HistoryService.js';
import { HistoryArchiveStatusFinder } from '../HistoryArchiveStatusFinder.js';
import { mock } from 'jest-mock-extended';

describe('HistoryArchiveStatusFinder', () => {
	const originalExclusions = process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
	afterEach(() => {
		if (originalExclusions === undefined)
			delete process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS;
		else process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS = originalExclusions;
	});
	it('does not fetch or mark operator-excluded archives healthy', async () => {
		process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS =
			'stellar-history-de-fra.satoshipay.io';
		const historyService = mock<HistoryService>();
		historyService.stellarHistoryIsUpToDate.mockResolvedValue(true);
		const finder = new HistoryArchiveStatusFinder(historyService);
		const result = await finder.getNodesWithUpToDateHistoryArchives(
			new Map([
				['excluded', 'https://stellar-history-de-fra.satoshipay.io/'],
				['allowed', 'https://history.stellar.org/prd/core-live/core_live_001']
			]),
			64n
		);
		expect(historyService.stellarHistoryIsUpToDate).toHaveBeenCalledTimes(1);
		expect(historyService.stellarHistoryIsUpToDate).toHaveBeenCalledWith(
			'https://history.stellar.org/prd/core-live/core_live_001',
			'64'
		);
		expect(result).toEqual(new Set(['allowed']));
	});
	it('returns promptly when every archive is excluded', async () => {
		process.env.HISTORY_ARCHIVE_EXCLUDED_HOSTS =
			'stellar-history-de-fra.satoshipay.io';
		const historyService = mock<HistoryService>();
		const result = await new HistoryArchiveStatusFinder(
			historyService
		).getNodesWithUpToDateHistoryArchives(
			new Map([['excluded', 'https://stellar-history-de-fra.satoshipay.io/']]),
			64n
		);
		expect(result.size).toBe(0);
		expect(historyService.stellarHistoryIsUpToDate).not.toHaveBeenCalled();
	});
	it('return the nodes with up-to-date history archives', async function () {
		const historyService = mock<HistoryService>();
		const historyArchiveStatusFinder = new HistoryArchiveStatusFinder(
			historyService
		);

		const map = new Map([
			['GAA', 'https://history.stellar.org/prd/core-live/core_live_001'],
			['GAB', 'https://history.stellar.org/prd/core-live/core_live_002']
		]);

		historyService.stellarHistoryIsUpToDate.mockResolvedValueOnce(true);

		const publicKeys =
			await historyArchiveStatusFinder.getNodesWithUpToDateHistoryArchives(
				map,
				BigInt(1)
			);

		expect(publicKeys.size).toEqual(1);
		expect(publicKeys.has('GAA')).toBeTruthy();
	});
});
