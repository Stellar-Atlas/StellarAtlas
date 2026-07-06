import * as stream from 'stream';
import { err, ok, Result } from 'neverthrow';
import { CategoryRequestMeta, RequestGenerator } from './RequestGenerator.js';
import {
	FileNotFoundError,
	HttpQueue,
	QueueError,
	Request,
	RequestMethod,
	RetryableQueueError,
	Url,
	asyncSleep
} from 'http-helper';
import { HASValidator } from '../history-archive/HASValidator.js';
import { inject, injectable } from 'inversify';
import { HASBucketHashExtractor } from '../history-archive/HASBucketHashExtractor.js';
import { mapHttpQueueErrorToScanError } from './mapHttpQueueErrorToScanError.js';
import { isObject, mapUnknownToError } from 'shared';
import { createGunzip } from 'zlib';
import { XdrStreamReader } from './XdrStreamReader.js';
import { pipeline } from 'stream/promises';
import { CategoryXDRProcessor } from './CategoryXDRProcessor.js';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';
import { UrlBuilder } from '../history-archive/UrlBuilder.js';
import { CheckPointGenerator } from '../check-point/CheckPointGenerator.js';
import { CategoryScanState } from './ScanState.js';
import { LedgerHeader } from './Scanner.js';
import { hashBucketList } from '../history-archive/hashBucketList.js';
import { WorkerPoolLoadTracker } from './WorkerPoolLoadTracker.js';
import { CategoryVerificationService } from './CategoryVerificationService.js';
import { HasherPool } from './HasherPool.js';
import { isZLibError } from './isZLibError.js';
import { getMaximumNumber } from './getMaximumNumber.js';
import { TYPES } from './../../infrastructure/di/di-types.js';
import { createCategoryVerificationScanErrors } from './createCategoryVerificationScanErrors.js';
import { terminateHasherPool } from './terminateHasherPool.js';
import { noopParsedHistorySink } from './parsed-history/ParsedHistorySink.js';
import type { ParsedHistorySink } from './parsed-history/ParsedHistorySink.js';
import type { ArchiveMetadataDTO } from 'history-scanner-dto';
import { sendRequestsCollectingArchiveErrors } from './sendRequestsCollectingArchiveErrors.js';
import { ArchiveScanErrorAccumulator } from './ArchiveScanErrorAccumulator.js';

type Ledger = number;
type Hash = string;

export interface LatestLedgerArchiveState {
	readonly ledger: number;
	readonly archiveMetadata: ArchiveMetadataDTO;
}

export interface HASScanResult {
	readonly bucketHashes: Set<string>;
	readonly bucketListHashes: Map<number, string>;
	readonly errors: readonly ScanError[];
}

export interface ExpectedHashes {
	txSetHash: Hash;
	txSetResultHash: Hash;
	previousLedgerHeaderHash: Hash;
	bucketListHash: Hash;
}
export type ExpectedHashesPerLedger = Map<Ledger, ExpectedHashes>;
export type CalculatedTxSetHashes = Map<Ledger, Hash>;
export type CalculatedTxSetResultHashes = Map<Ledger, Hash>;
export type LedgerHeaderHashes = Map<Ledger, Hash | undefined>;

export interface CategoryVerificationData {
	calculatedTxSetHashes: CalculatedTxSetHashes;
	expectedHashesPerLedger: ExpectedHashesPerLedger;
	calculatedTxSetResultHashes: CalculatedTxSetResultHashes;
	calculatedLedgerHeaderHashes: LedgerHeaderHashes;
	protocolVersions: Map<number, number>;
}

@injectable()
export class CategoryScanner {
	static ZeroXdrHash = '3z9hmASpL9tAVxktxD3XSOp3itxSvEmM6AUkwBS4ERk=';
	static ZeroHash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
	static POOL_MAX_PENDING_TASKS = 20000;

	constructor(
		private hasValidator: HASValidator,
		@inject(TYPES.HttpQueue) private httpQueue: HttpQueue,
		private checkPointGenerator: CheckPointGenerator,
		private categoryVerificationService: CategoryVerificationService,
		@inject(TYPES.HasherWorkerCount) private readonly hasherWorkerCount: number
	) {}

	public async findLatestLedger(
		baseUrl: Url
	): Promise<Result<LatestLedgerArchiveState, ScanError>> {
		const rootHASUrl = UrlBuilder.getRootHASUrl(baseUrl);
		const rootHASUrlRequest: Request[] = [
			{
				url: rootHASUrl,
				method: RequestMethod.GET,
				meta: {}
			}
		];

		let archiveMetadata: ArchiveMetadataDTO | undefined;
		const successOrError = await this.httpQueue.sendRequests(
			rootHASUrlRequest[Symbol.iterator](),
			{
				stallTimeMs: 150,
				concurrency: 1,
				nrOfRetries: 6, //last retry is after 1 min wait. 2 minute total wait time
				rampUpConnections: true,
				httpOptions: {
					responseType: 'json',
					socketTimeoutMs: 4000 //timeout to download file
				}
			},
			async (result: unknown, request) => {
				if (!isObject(result)) {
					return err(new FileNotFoundError(request));
				}
				const validateHASResult = this.hasValidator.validate(result);
				if (validateHASResult.isOk()) {
					archiveMetadata = {
						stellarHistoryUrl: rootHASUrl.value,
						stellarHistory: validateHASResult.value,
						observedAt: new Date().toISOString()
					};
					return ok(undefined);
				} else {
					return err(new QueueError(request, validateHASResult.error));
				}
			}
		);

		if (successOrError.isErr()) {
			return err(mapHttpQueueErrorToScanError(successOrError.error));
		}

		if (archiveMetadata === undefined) {
			return err(
				new ScanError(
					ScanErrorType.TYPE_VERIFICATION,
					rootHASUrl.value,
					'No latest ledger found'
				)
			);
		}

		return ok({
			ledger: archiveMetadata.stellarHistory.currentLedger,
			archiveMetadata
		});
	}

	//fetches all HAS files in checkpoint range and returns all detected bucket urls
	public async scanHASFilesAndReturnBucketHashes(
		scanState: CategoryScanState,
		verify = true
	): Promise<Result<HASScanResult, ScanError>> {
		const historyArchiveStateURLGenerator =
			RequestGenerator.generateHASRequests(
				scanState.baseUrl,
				scanState.checkPoints,
				RequestMethod.GET
			);

		const bucketHashes = new Set<string>();
		const successOrError = await sendRequestsCollectingArchiveErrors(
			this.httpQueue,
			historyArchiveStateURLGenerator,
			{
				stallTimeMs: 150,
				concurrency: scanState.concurrency,
				nrOfRetries: 6, //last retry is after 1 min wait. 2 minute total wait time
				rampUpConnections: true,
				httpOptions: {
					httpAgent: scanState.httpAgent,
					httpsAgent: scanState.httpsAgent,
					responseType: 'json',
					socketTimeoutMs: 4000 //timeout to download file
				}
			},
			async (result: unknown, request) => {
				if (!isObject(result)) {
					return err(new FileNotFoundError(request));
				}
				const validateHASResult = this.hasValidator.validate(result);
				if (validateHASResult.isOk()) {
					HASBucketHashExtractor.getNonZeroHashes(
						validateHASResult.value
					).forEach((hash) => bucketHashes.add(hash));
					if (verify) {
						const bucketListHashResult = hashBucketList(
							validateHASResult.value
						);
						if (bucketListHashResult.isOk())
							scanState.bucketListHashes.set(
								bucketListHashResult.value.ledger,
								bucketListHashResult.value.hash
							);
					}
					return ok(undefined);
				} else {
					return err(new QueueError(request, validateHASResult.error));
				}
			}
		);

		if (successOrError.isErr()) return err(successOrError.error);

		return ok({
			bucketHashes: bucketHashes,
			bucketListHashes: scanState.bucketListHashes,
			errors: successOrError.value.errors
		});
	}

	async scanOtherCategories(
		scanState: CategoryScanState,
		verify = false,
		parsedHistorySink: ParsedHistorySink = noopParsedHistorySink
	): Promise<Result<LedgerHeader | undefined, ScanError>> {
		if (!verify) return await this.otherCategoriesExist(scanState);

		return await this.verifyOtherCategories(scanState, parsedHistorySink);
	}

	private async verifyOtherCategories(
		scanState: CategoryScanState,
		parsedHistorySink: ParsedHistorySink
	): Promise<Result<undefined | LedgerHeader, ScanError>> {
		const pool = new HasherPool(this.hasherWorkerCount);
		const poolLoadTracker = new WorkerPoolLoadTracker(
			pool,
			CategoryScanner.POOL_MAX_PENDING_TASKS
		);

		const categoryVerificationData: CategoryVerificationData = {
			calculatedTxSetHashes: new Map(),
			expectedHashesPerLedger: new Map(),
			calculatedTxSetResultHashes: new Map(),
			calculatedLedgerHeaderHashes: new Map(),
			protocolVersions: new Map()
		};

		const processRequestResult = async (
			readStream: unknown,
			request: Request<CategoryRequestMeta>
		): Promise<Result<void, QueueError>> => {
			if (!(readStream instanceof stream.Readable)) {
				return err(new FileNotFoundError(request));
			}

			const xdrStreamReader = new XdrStreamReader();
			const gunzip = createGunzip();
			const categoryXDRProcessor = new CategoryXDRProcessor(
				pool,
				request.url,
				request.meta.category,
				categoryVerificationData,
				parsedHistorySink
			);
			try {
				await pipeline([
					readStream,
					gunzip,
					xdrStreamReader,
					categoryXDRProcessor
				]);
				while (
					pool.workerpool.stats().pendingTasks >
					CategoryScanner.POOL_MAX_PENDING_TASKS
				) {
					await asyncSleep(10);
				}
				return ok(undefined);
			} catch (error) {
				if (isZLibError(error)) {
					return err(
						new RetryableQueueError(
							request,
							new ScanError(
								ScanErrorType.TYPE_VERIFICATION,
								request.url.value,
								error.message
							)
						)
					);
				} else {
					return err(
						new RetryableQueueError(request, mapUnknownToError(error))
					);
				}
			}
		};

		const requestResult = await sendRequestsCollectingArchiveErrors(
			this.httpQueue,
			RequestGenerator.generateCategoryRequests(
				scanState.checkPoints,
				scanState.baseUrl,
				RequestMethod.GET
			),
			{
				stallTimeMs: 150,
				concurrency: scanState.concurrency,
				nrOfRetries: 6, //last retry is after 1 min wait. 2 minute total wait time
				rampUpConnections: true,
				httpOptions: {
					httpAgent: scanState.httpAgent,
					httpsAgent: scanState.httpsAgent,
					responseType: 'stream',
					socketTimeoutMs: 60000,
					connectionTimeoutMs: 10000
				}
			},
			processRequestResult
		);

		await terminateHasherPool(poolLoadTracker, pool);

		if (requestResult.isErr()) return err(requestResult.error);

		const scanErrors = new ArchiveScanErrorAccumulator();
		scanErrors.addMany(requestResult.value.errors);

		const verificationErrors = this.categoryVerificationService.verifyAll(
			categoryVerificationData,
			scanState.bucketListHashes,
			this.checkPointGenerator.checkPointFrequency,
			scanState.previousLedgerHeader
		);

		if (verificationErrors.length > 0) {
			scanErrors.addMany(
				createCategoryVerificationScanErrors(
					scanState.baseUrl,
					this.checkPointGenerator,
					verificationErrors
				)
			);
		}

		const aggregateError = scanErrors.toAggregate();
		if (aggregateError !== undefined) {
			return err(aggregateError);
		}

		const maxLedger = getMaximumNumber([
			...categoryVerificationData.calculatedLedgerHeaderHashes.keys()
		]);

		return ok({
			ledger: maxLedger,
			hash: categoryVerificationData.calculatedLedgerHeaderHashes.get(
				maxLedger
			) as string
		});
	}

	private async otherCategoriesExist(
		scanState: CategoryScanState
	): Promise<Result<undefined, ScanError>> {
		const generateCategoryQueueUrls = RequestGenerator.generateCategoryRequests(
			scanState.checkPoints,
			scanState.baseUrl,
			RequestMethod.HEAD
		);

		const categoriesExistResult = await this.httpQueue.sendRequests(
			generateCategoryQueueUrls,
			{
				stallTimeMs: 150,
				concurrency: scanState.concurrency,
				nrOfRetries: 5,
				rampUpConnections: true,
				httpOptions: {
					responseType: undefined,
					socketTimeoutMs: 10000,
					httpAgent: scanState.httpAgent,
					httpsAgent: scanState.httpsAgent
				}
			}
		);

		if (categoriesExistResult.isErr()) {
			return err(mapHttpQueueErrorToScanError(categoriesExistResult.error));
		}

		return ok(undefined);
	}
}
