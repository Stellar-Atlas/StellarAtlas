import { err, ok, Result } from 'neverthrow';
import { Scanner } from '../../domain/scanner/Scanner.js';
import type { ExceptionLogger } from 'exception-logger';
import { mapUnknownToError, normalizeHistoryArchiveRootUrl } from 'shared';
import { VerifySingleArchiveDTO } from './VerifySingleArchiveDTO.js';
import { ScanJob } from '../../domain/scan/ScanJob.js';
import { Url } from 'http-helper';
import { inject, injectable } from 'inversify';
import { TYPES } from '../../infrastructure/di/di-types.js';

@injectable()
export class VerifySingleArchive {
	constructor(
		private scanner: Scanner,
		@inject(TYPES.ExceptionLogger)
		private exceptionLogger: ExceptionLogger
	) {}

	public async execute(
		verifySingleArchiveDTO: VerifySingleArchiveDTO
	): Promise<Result<void, Error>> {
		try {
			const historyArchiveOrError = await VerifySingleArchive.getArchiveUrl(
				verifySingleArchiveDTO.historyUrl
			);
			if (historyArchiveOrError.isErr()) {
				//stop the script
				this.exceptionLogger.captureException(historyArchiveOrError.error);
				return err(historyArchiveOrError.error);
			}

			await this.scanArchive(
				historyArchiveOrError.value,
				verifySingleArchiveDTO.fromLedger,
				verifySingleArchiveDTO.toLedger,
				verifySingleArchiveDTO.maxConcurrency
			);
		} catch (e) {
			this.exceptionLogger.captureException(mapUnknownToError(e));
		}
		return ok(undefined);
	}

	private static async getArchiveUrl(
		historyUrl: string
	): Promise<Result<Url, Error>> {
		const normalizedUrl = normalizeHistoryArchiveRootUrl(historyUrl);
		if (normalizedUrl === null) {
			return err(new Error('Invalid history archive root URL'));
		}

		const historyBaseUrl = Url.create(normalizedUrl);

		if (historyBaseUrl.isErr()) {
			return err(historyBaseUrl.error);
		}

		return ok(historyBaseUrl.value);
	}

	private async scanArchive(
		archive: Url,
		fromLedger?: number,
		toLedger?: number,
		concurrency?: number
	) {
		const scanJob = ScanJob.newScanChain(
			archive,
			fromLedger,
			toLedger,
			concurrency
		);
		const scan = await this.scanner.perform(new Date(), scanJob);

		console.log(scan);
	}
}
