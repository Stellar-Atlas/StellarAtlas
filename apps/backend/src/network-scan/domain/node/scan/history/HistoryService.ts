import 'reflect-metadata';
import { err, ok, Result } from 'neverthrow';
import { isObject } from '@core/utilities/TypeGuards.js';
import { inject, injectable } from 'inversify';
import { isHttpError, Url, type HttpService } from 'http-helper';
import { CustomError } from '@core/errors/CustomError.js';
import type { Logger } from '@core/services/Logger.js';
import type { HistoryArchiveScanService } from './HistoryArchiveScanService.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { HistoryArchiveScan } from 'shared';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { HistoryArchiveStateRepository } from '@history-scan-coordinator/domain/history-archive-state/HistoryArchiveStateRepository.js';
import { isArchiveMetadataDTO } from 'history-scanner-dto';

export class FetchHistoryError extends CustomError {
	constructor(url: string, cause?: Error) {
		super('Failed fetching history at ' + url, FetchHistoryError.name, cause);
	}
}

@injectable()
export class HistoryService {
	constructor(
		@inject('HttpService') protected httpService: HttpService,
		@inject(NETWORK_TYPES.HistoryArchiveScanService)
		protected historyArchiveScanService: HistoryArchiveScanService,
		@inject(TYPES.HistoryArchiveStateRepository)
		protected historyArchiveStateRepository: HistoryArchiveStateRepository,
		@inject('Logger') protected logger: Logger
	) {}

	async fetchStellarHistoryLedger(
		historyUrl: string
	): Promise<Result<number, FetchHistoryError>> {
		historyUrl = historyUrl.replace(/\/+$/, '');
		const stellarHistoryUrl = buildHistoryArchiveStateUrl(historyUrl);

		const urlResult = Url.create(stellarHistoryUrl);
		if (urlResult.isErr())
			return err(new FetchHistoryError(stellarHistoryUrl, urlResult.error));

		const response = await this.httpService.get(urlResult.value);
		if (response.isErr()) {
			await this.historyArchiveStateRepository.saveFailure({
				archiveUrl: historyUrl,
				stateUrl: stellarHistoryUrl,
				status: 'unreachable',
				errorType: response.error.code ?? response.error.name,
				errorMessage: response.error.message,
				httpStatus: isHttpError(response.error)
					? (response.error.response?.status ?? null)
					: null,
				observedAt: new Date(),
				source: 'network-scan'
			});
			return err(new FetchHistoryError(stellarHistoryUrl, response.error));
		}

		if (!isObject(response.value.data)) {
			await this.historyArchiveStateRepository.saveFailure({
				archiveUrl: historyUrl,
				stateUrl: stellarHistoryUrl,
				status: 'invalid',
				errorType: 'invalid_response',
				errorMessage: 'Invalid history archive state response',
				httpStatus: response.value.status,
				observedAt: new Date(),
				source: 'network-scan'
			});
			return err(
				new FetchHistoryError(
					stellarHistoryUrl,
					new Error('Invalid history response, no data property')
				)
			);
		}

		const archiveMetadata = {
			stellarHistoryUrl,
			stellarHistory: response.value.data,
			observedAt: new Date().toISOString()
		};
		if (!isArchiveMetadataDTO(archiveMetadata)) {
			await this.historyArchiveStateRepository.saveFailure({
				archiveUrl: historyUrl,
				stateUrl: stellarHistoryUrl,
				status: 'invalid',
				errorType: 'invalid_shape',
				errorMessage: 'History archive state response did not match expected shape',
				httpStatus: response.value.status,
				observedAt: new Date(),
				source: 'network-scan'
			});

			return err(
				new FetchHistoryError(
					stellarHistoryUrl,
					new Error('History archive state response did not match expected shape')
				)
			);
		}

		await this.historyArchiveStateRepository.saveAvailable(
			historyUrl,
			archiveMetadata,
			'network-scan'
		);

		return ok(archiveMetadata.stellarHistory.currentLedger);
	}

	async stellarHistoryIsUpToDate(
		historyUrl: string,
		latestLedger: string
	): Promise<boolean> {
		const stellarHistoryResult =
			await this.fetchStellarHistoryLedger(historyUrl);

		if (stellarHistoryResult.isErr()) {
			this.logger.info(stellarHistoryResult.error.message);
			return false;
		}

		//todo: latestLedger sequence is bigint, but horizon returns number type for ledger sequence
		return stellarHistoryResult.value + 100 >= Number(latestLedger); //allow for a margin of 100 ledgers to account for delay in archiving
	}

	async getHistoryUrlsWithScanErrors(
		historyUrls: string[]
	): Promise<Result<Set<string>, Error>> {
		const scanResult = await this.historyArchiveScanService.findLatestScans();
		if (scanResult.isErr()) return err(scanResult.error);
		const scansWithErrors = new Set(
			scanResult.value
				.filter(hasArchiveVerificationError)
				.map((scan) => scan.url)
		);
		this.logger.info('History archive errors', {
			urls: Array.from(scansWithErrors)
		});

		const historyUrlsWithErrors = new Set<string>();

		historyUrls.forEach((historyUrl) => {
			const urlResult = Url.create(historyUrl); //to make sure matching happens (trailing slashes etc), could use a cleaner solution
			if (urlResult.isErr())
				this.logger.info('Invalid history url', {
					url: historyUrl
				});
			else if (scansWithErrors.has(urlResult.value.value)) {
				historyUrlsWithErrors.add(historyUrl);
			}
		});

		return ok(historyUrlsWithErrors);
	}

	async scheduleScans(historyUrls: string[]): Promise<void> {
		this.historyArchiveScanService.scheduleScans(historyUrls);
	}
}

function buildHistoryArchiveStateUrl(historyUrl: string): string {
	return `${historyUrl.replace(/\/+$/, '')}/.well-known/stellar-history.json`;
}

const hasArchiveVerificationError = (scan: HistoryArchiveScan): boolean => {
	if (scan.errors.length === 0) return scan.hasError;

	return scan.errors.some((error) => error.type === 'TYPE_VERIFICATION');
};
