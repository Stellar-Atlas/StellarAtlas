import { err, ok } from 'neverthrow';
import { HistoryService } from '../HistoryService.js';
import { LoggerMock } from '@core/services/__mocks__/LoggerMock.js';
import { mock, mockReset } from 'jest-mock-extended';
import { HttpError, type HttpService } from 'http-helper';
import type { HistoryArchiveScanService } from '../HistoryArchiveScanService.js';
import { HistoryArchiveScan } from 'shared';
import type { HistoryArchiveStateRepository } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateRepository.js';

const httpService = mock<HttpService>();
const historyArchiveScanService = mock<HistoryArchiveScanService>();
const historyArchiveStateRepository = mock<HistoryArchiveStateRepository>();

beforeEach(() => {
	mockReset(httpService);
	mockReset(historyArchiveScanService);
	mockReset(historyArchiveStateRepository);
});

const stellarHistoryJson =
	'{\n' +
	'    "version": 1,\n' +
	'    "server": "v10.2.0-64-g89f2ba32",\n' +
	'    "currentLedger": 23586760,\n' +
	'    "currentBuckets": [\n' +
	'        {\n' +
	'            "curr": "e7984e605971d07352e4eda31a61c4e25bc0d8c5bab28e2731639534a1b813a1",\n' +
	'            "next": {\n' +
	'                "state": 0\n' +
	'            },\n' +
	'            "snap": "bb88aeb1a3418126682c52aaf3b88fae1fb3cd1df47aa6901c8d7fc172fa9ad8"\n' +
	'        }]}';

test('fetchStellarHistory', async () => {
	const historyService = createHistoryService();
	httpService.get.mockReturnValue(
		new Promise((resolve) =>
			resolve(
				ok({
					data: JSON.parse(stellarHistoryJson),
					status: 200,
					statusText: 'ok',
					headers: {}
				})
			)
		)
	);

	const result = await historyService.fetchStellarHistoryLedger(
		'https://stellar.sui.li/history/'
	);
	expect(result.isOk()).toBeTruthy();
	if (result.isErr()) return;
	expect(result.value).toEqual(23586760);
	expect(historyArchiveStateRepository.saveAvailable).toHaveBeenCalledWith(
		'https://stellar.sui.li/history',
		expect.objectContaining({
			stellarHistoryUrl:
				'https://stellar.sui.li/history/.well-known/stellar-history.json'
		}),
		'network-scan'
	);
});

test('stellarHistoryIsUpToDate', async () => {
	const historyService = createHistoryService();
	httpService.get.mockReturnValue(
		new Promise((resolve) =>
			resolve(
				ok({
					data: JSON.parse(stellarHistoryJson),
					status: 200,
					statusText: 'ok',
					headers: {}
				})
			)
		)
	);

	expect(
		await historyService.stellarHistoryIsUpToDate(
			'https://stellar.sui.li/history/',
			'23586800'
		)
	).toEqual(true);
});

test('stellarHistoryIsNotUpToDate', async () => {
	const historyService = createHistoryService();
	httpService.get.mockReturnValue(
		new Promise((resolve) =>
			resolve(
				ok({
					data: JSON.parse(stellarHistoryJson),
					status: 200,
					statusText: 'ok',
					headers: {}
				})
			)
		)
	);

	expect(
		await historyService.stellarHistoryIsUpToDate(
			'https://stellar.sui.li/history/',
			'25586760'
		)
	).toEqual(false);
});

test('fetchStellarHistory records unreachable state fetches', async () => {
	const historyService = createHistoryService();
	httpService.get.mockResolvedValue(
		err(new HttpError('connection refused', 'ECONNREFUSED'))
	);

	const result = await historyService.fetchStellarHistoryLedger(
		'https://stellar.sui.li/history/'
	);

	expect(result.isErr()).toBeTruthy();
	expect(historyArchiveStateRepository.saveFailure).toHaveBeenCalledWith(
		expect.objectContaining({
			archiveUrl: 'https://stellar.sui.li/history',
			stateUrl: 'https://stellar.sui.li/history/.well-known/stellar-history.json',
			status: 'unreachable',
			errorType: 'ECONNREFUSED',
			source: 'network-scan'
		})
	);
});

it('should return urls with historyErrors', async function () {
	const historyService = createHistoryService();
	const urlWithError = 'https://gap.co/'; //trailing slash should be removed when comparing with scan

	const urlWithoutError = 'https://nogap.co';

	const unknownUrl = 'https://unknown.co';

	historyArchiveScanService.findLatestScans.mockReturnValue(
		new Promise((resolve) => {
			resolve(
				ok([
					new HistoryArchiveScan(
						'https://gap.co',
						new Date(),
						new Date(),
						10,
						true,
						null,
						null,
						false,
						[
							{
								message: 'Wrong transaction hash',
								type: 'TYPE_VERIFICATION',
								url: 'https://gap.co/transactions/00/00/00.xdr.gz'
							}
						]
					),
					new HistoryArchiveScan(
						'https://connection-issue.co',
						new Date(),
						new Date(),
						10,
						true,
						null,
						null,
						false,
						[
							{
								message: 'Could not fetch latest ledger',
								type: 'TYPE_CONNECTION',
								url: 'https://connection-issue.co'
							}
						]
					),
					new HistoryArchiveScan(
						'https://nogap.co',
						new Date(),
						new Date(),
						10,
						false,
						null,
						null,
						false
					)
				])
			);
		})
	);

	const result = await historyService.getHistoryUrlsWithScanErrors([
		urlWithError,
		urlWithoutError,
		'https://connection-issue.co',
		unknownUrl
	]);
	if (result.isErr()) throw result.error;

	expect(result.value.size).toEqual(1);
	expect(result.value.has(urlWithError)).toBeTruthy();
});

function createHistoryService(): HistoryService {
	return new HistoryService(
		httpService,
		historyArchiveScanService,
		historyArchiveStateRepository,
		new LoggerMock()
	);
}
