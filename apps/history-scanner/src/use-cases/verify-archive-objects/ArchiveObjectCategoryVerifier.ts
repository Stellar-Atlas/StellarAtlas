import { createGunzip } from 'node:zlib';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { err, ok, type Result } from 'neverthrow';
import { Url, isHttpError, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import { mapUnknownToError } from 'shared';
import { Category } from '../../domain/history-archive/Category.js';
import { HistoryArchiveStateValidator } from '../../domain/history-archive/HistoryArchiveStateValidator.js';
import type { CategoryVerificationData } from '../../domain/scanner/CategoryScanner.js';
import { CategoryXDRProcessor } from '../../domain/scanner/CategoryXDRProcessor.js';
import { HasherPool } from '../../domain/scanner/HasherPool.js';
import { XdrStreamReader } from '../../domain/scanner/XdrStreamReader.js';
import { CoordinatorParsedHistorySink } from '../../infrastructure/services/CoordinatorParsedHistorySink.js';
import type {
	HistoryArchiveObjectFailureDTO,
	HistoryArchiveObjectJobDTO,
	HistoryArchiveObjectProgressDTO,
	ScanCoordinatorService
} from '../../domain/scan/ScanCoordinatorService.js';

type ProgressReporter = (
	remoteId: string,
	workerStage: string,
	bytesDownloaded: number | null
) => void;

export class ArchiveObjectCategoryVerifier {
	constructor(
		private readonly httpService: HttpService,
		private readonly scanCoordinator: ScanCoordinatorService,
		private readonly historyArchiveStateValidator: HistoryArchiveStateValidator,
		private readonly exceptionLogger: ExceptionLogger,
		private readonly hasherWorkerCount: number,
		private readonly reportProgress: ProgressReporter
	) {}

	async verifyCheckpointState(
		job: HistoryArchiveObjectJobDTO
	): Promise<Result<HistoryArchiveObjectProgressDTO, HistoryArchiveObjectFailureDTO>> {
		this.reportProgress(job.remoteId, 'fetching_checkpoint_state', null);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(this.mapLocalError(urlResult.error));

		const response = await this.httpService.get(urlResult.value, {
			responseType: 'json',
			connectionTimeoutMs: 5_000,
			socketTimeoutMs: 10_000
		});
		if (response.isErr()) return err(this.mapHttpError(response.error));

		const state = response.value.data;
		if (!isRecord(state)) {
			return err({
				errorMessage: 'Checkpoint state response must be a JSON object',
				errorType: 'invalid_checkpoint_state',
				httpStatus: response.value.status
			});
		}

		const validation = this.historyArchiveStateValidator.validate(state);
		if (validation.isErr()) {
			return err({
				errorMessage: validation.error.message,
				errorType: 'invalid_checkpoint_state',
				httpStatus: response.value.status
			});
		}

		const bytesDownloaded = Buffer.byteLength(JSON.stringify(state));
		this.reportProgress(
			job.remoteId,
			'verified_checkpoint_state',
			bytesDownloaded
		);
		return ok({ bytesDownloaded, workerStage: 'verified' });
	}

	async verifyCategoryObject(
		job: HistoryArchiveObjectJobDTO
	): Promise<Result<HistoryArchiveObjectProgressDTO, HistoryArchiveObjectFailureDTO>> {
		const category = getCategory(job.objectType);
		if (category === null) {
			return err({
				errorMessage: `Unsupported category object type: ${job.objectType}`,
				errorType: 'unsupported_object_type',
				httpStatus: null
			});
		}

		this.reportProgress(job.remoteId, `fetching_${job.objectType}`, 0);
		const urlResult = Url.create(job.objectUrl);
		if (urlResult.isErr()) return err(this.mapLocalError(urlResult.error));

		const response = await this.httpService.get(urlResult.value, {
			responseType: 'stream',
			connectionTimeoutMs: 10_000,
			socketTimeoutMs: 60_000
		});
		if (response.isErr()) return err(this.mapHttpError(response.error));
		if (!isReadable(response.value.data)) {
			return err({
				errorMessage: `${job.objectType} response must be a readable stream`,
				errorType: 'invalid_category_response',
				httpStatus: response.value.status
			});
		}

		let bytesDownloaded = 0;
		const countedStream = response.value.data.pipe(
			new ByteCounter((bytes) => {
				bytesDownloaded += bytes;
				this.reportProgress(
					job.remoteId,
					`downloading_${job.objectType}`,
					bytesDownloaded
				);
			})
		);
		const pool = new HasherPool(Math.max(Math.floor(this.hasherWorkerCount), 1));
		const parsedHistorySink =
			category === Category.ledger
				? new CoordinatorParsedHistorySink(
						this.scanCoordinator,
						job.archiveUrl,
						job.remoteId,
						this.exceptionLogger
					)
				: undefined;

		try {
			await pipeline([
				countedStream,
				createGunzip(),
				new XdrStreamReader(),
				new CategoryXDRProcessor(
					pool,
					urlResult.value,
					category,
					createCategoryVerificationData(),
					parsedHistorySink
				)
			]);
			await parsedHistorySink?.flush();
			this.reportProgress(
				job.remoteId,
				`verified_${job.objectType}`,
				bytesDownloaded
			);
			return ok({ bytesDownloaded, workerStage: 'verified' });
		} catch (error) {
			return err({
				errorMessage: mapUnknownToError(error).message,
				errorType: 'category_verification_failed',
				httpStatus: response.value.status
			});
		} finally {
			await pool.workerpool.terminate(true).catch(() => undefined);
			pool.terminated = true;
		}
	}

	private mapHttpError(error: unknown): HistoryArchiveObjectFailureDTO {
		if (isHttpError(error)) {
			return {
				errorMessage: error.message,
				errorType: error.response ? 'archive_http_error' : 'archive_transport_error',
				httpStatus: error.response?.status ?? null
			};
		}

		const mapped = mapUnknownToError(error);
		return {
			errorMessage: mapped.message,
			errorType: 'archive_transport_error',
			httpStatus: null
		};
	}

	private mapLocalError(error: unknown): HistoryArchiveObjectFailureDTO {
		const mapped = mapUnknownToError(error);
		return {
			errorMessage: mapped.message,
			errorType: 'worker_error',
			httpStatus: null
		};
	}
}

class ByteCounter extends Transform {
	constructor(onBytes: (bytes: number) => void) {
		super({
			transform(chunk: Buffer, _encoding, callback) {
				onBytes(chunk.length);
				callback(null, chunk);
			}
		});
	}
}

function getCategory(objectType: string): Category | null {
	switch (objectType) {
		case 'ledger':
			return Category.ledger;
		case 'transactions':
			return Category.transactions;
		case 'results':
			return Category.results;
		default:
			return null;
	}
}

function createCategoryVerificationData(): CategoryVerificationData {
	return {
		calculatedLedgerHeaderHashes: new Map(),
		calculatedTxSetHashes: new Map(),
		calculatedTxSetResultHashes: new Map(),
		expectedHashesPerLedger: new Map(),
		protocolVersions: new Map()
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReadable(value: unknown): value is Readable {
	return (
		typeof value === 'object' &&
		value !== null &&
		'pipe' in value &&
		typeof value.pipe === 'function'
	);
}
