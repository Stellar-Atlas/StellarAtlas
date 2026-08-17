import type { HistoryArchiveWorkerStageDTO } from 'history-scanner-dto';
import type { HttpService } from 'http-helper';
import { Url } from 'http-helper';
import { err, ok, type Result } from 'neverthrow';
import { HistoryArchiveStateValidator } from '../../domain/history-archive/HistoryArchiveStateValidator.js';
import type {
	HistoryArchiveObjectCompletionDTO,
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO
} from '../../domain/scan/ScanCoordinatorService.js';
import { canonicalJsonContentDigest } from './ArchiveObjectContentDigest.js';
import {
	mapArchiveObjectHttpError,
	mapArchiveObjectLocalError
} from './ArchiveObjectWorkerHelpers.js';

type ProgressReporter = (
	remoteId: string,
	workerStage: HistoryArchiveWorkerStageDTO,
	bytesDownloaded: number | null
) => void;

export class ArchiveObjectHistoryStateVerifier {
	constructor(
		private readonly httpService: HttpService,
		private readonly historyArchiveStateValidator: HistoryArchiveStateValidator,
		private readonly reportProgress: ProgressReporter
	) {}

	async verify(
		job: HistoryArchiveObjectJobDTO,
		releaseDownloadPermit: () => void
	): Promise<
		Result<HistoryArchiveObjectCompletionDTO, HistoryArchiveObjectFailureDTO>
	> {
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr())
			return err(mapArchiveObjectLocalError(urlResult.error));

		this.reportProgress(job.remoteId, 'fetching_history_archive_state', null);
		const response = await this.httpService
			.get(urlResult.value, {
				responseType: 'json',
				connectionTimeoutMs: 5_000,
				socketTimeoutMs: 10_000
			})
			.finally(releaseDownloadPermit);
		if (response.isErr()) return err(mapArchiveObjectHttpError(response.error));

		const state = response.value.data;
		if (!isRecord(state)) {
			return err({
				errorMessage: 'History archive state response must be a JSON object',
				errorType: 'invalid_history_archive_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}

		const validation = this.historyArchiveStateValidator.validate(state);
		if (validation.isErr()) {
			return err({
				errorMessage: validation.error.message,
				errorType: 'invalid_history_archive_state',
				failureChannel: 'archive_evidence',
				httpStatus: response.value.status
			});
		}

		const bytesDownloaded = Buffer.byteLength(JSON.stringify(state));
		this.reportProgress(
			job.remoteId,
			'verified_history_archive_state',
			bytesDownloaded
		);
		return ok({
			archiveMetadata: {
				observedAt: new Date().toISOString(),
				stellarHistory: validation.value,
				stellarHistoryUrl: job.objectUrl
			},
			bytesDownloaded,
			verificationFacts: {
				content: canonicalJsonContentDigest(validation.value)
			},
			workerStage: 'verified'
		});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
