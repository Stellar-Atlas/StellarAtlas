import { err, ok, Result } from 'neverthrow';
import { BucketScanState } from './ScanState.js';
import { BucketRequestMeta, RequestGenerator } from './RequestGenerator.js';
import {
	FileNotFoundError,
	HttpQueue,
	QueueError,
	Request,
	RequestMethod,
	RetryableQueueError
} from 'http-helper';
import { inject, injectable } from 'inversify';
import { mapHttpQueueErrorToScanError } from './mapHttpQueueErrorToScanError.js';
import { createGunzip } from 'zlib';
import { createHash } from 'crypto';
import * as stream from 'stream';
import { pipeline } from 'stream/promises';
import { mapUnknownToError } from 'shared';
import { ScanError, ScanErrorType } from '../scan/ScanError.js';
import { isZLibError } from './isZLibError.js';
import { TYPES } from '../../infrastructure/di/di-types.js';
import { BucketCache } from './BucketCache.js';

@injectable()
export class BucketScanner {
	constructor(
		@inject(TYPES.HttpQueue) private httpQueue: HttpQueue,
		private bucketCache: BucketCache
	) {}

	async scan(
		scanState: BucketScanState,
		verify = false
	): Promise<Result<void, ScanError>> {
		if (verify) {
			return await this.verify(scanState);
		} else {
			return await this.exists(scanState);
		}
	}

	private async verify(scanState: BucketScanState) {
		const verifyBucketStream = async (
			readStream: unknown,
			request: Request<BucketRequestMeta>
		): Promise<Result<void, QueueError>> => {
			if (!(readStream instanceof stream.Readable))
				return err(new FileNotFoundError(request));
			const zlib = createGunzip();
			const hasher = createHash('sha256');

			try {
				await pipeline(readStream, zlib, hasher);
				if (hasher.digest('hex') !== request.meta?.hash)
					return err(
						new QueueError(
							request,
							new ScanError(
								ScanErrorType.TYPE_VERIFICATION,
								request.url.value,
								'Wrong bucket hash'
							)
						)
					);
				return ok(undefined);
			} catch (error: unknown) {
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

		const bucketRequests = Array.from(
			RequestGenerator.generateBucketRequests(
				scanState.bucketHashesToScan,
				scanState.baseUrl,
				RequestMethod.GET
			)
		);
		const missingBucketRequestsResult =
			await this.verifyCachedBuckets(bucketRequests, scanState.concurrency);
		if (missingBucketRequestsResult.isErr()) {
			return err(mapHttpQueueErrorToScanError(missingBucketRequestsResult.error));
		}

		const missingBucketRequests = missingBucketRequestsResult.value;
		if (missingBucketRequests.length === 0) return ok(undefined);

		const verifyBucketsResult =
			await this.httpQueue.sendRequests<BucketRequestMeta>(
				missingBucketRequests.values(),
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
				async (readStream, request) => {
					if (!(readStream instanceof stream.Readable))
						return err(new FileNotFoundError(request));

					const verifyResult = await this.bucketCache.verifyAndStore(
						request.meta.hash,
						readStream,
						(streamToVerify) => verifyBucketStream(streamToVerify, request)
					);

					if (verifyResult.isErr()) {
						const error = verifyResult.error;
						if (error instanceof QueueError) return err(error);
						return err(new RetryableQueueError(request, error));
					}

					return ok(undefined);
				}
			);

		if (verifyBucketsResult.isErr()) {
			return err(mapHttpQueueErrorToScanError(verifyBucketsResult.error));
		}

		return ok(undefined);
	}

	private async exists(scanState: BucketScanState) {
		const bucketRequests = Array.from(
			RequestGenerator.generateBucketRequests(
				scanState.bucketHashesToScan,
				scanState.baseUrl,
				RequestMethod.HEAD
			)
		);
		const missingBucketRequestsResult = await this.filterCachedBucketRequests(
			bucketRequests,
			scanState.concurrency
		);
		if (missingBucketRequestsResult.isErr()) {
			return err(mapHttpQueueErrorToScanError(missingBucketRequestsResult.error));
		}

		const missingBucketRequests = missingBucketRequestsResult.value;
		if (missingBucketRequests.length === 0) return ok(undefined);

		const bucketsExistResult =
			await this.httpQueue.sendRequests<BucketRequestMeta>(
				missingBucketRequests.values(),
				{
					stallTimeMs: 150,
					concurrency: scanState.concurrency,
					nrOfRetries: 6, //last retry is after 1 min wait. 2 minute total wait time
					rampUpConnections: true,
					httpOptions: {
						responseType: undefined,
						socketTimeoutMs: 5000,
						connectionTimeoutMs: 5000,
						httpAgent: scanState.httpAgent,
						httpsAgent: scanState.httpsAgent
					}
				}
			);

		if (bucketsExistResult.isErr()) {
			return err(mapHttpQueueErrorToScanError(bucketsExistResult.error));
		}

		return ok(undefined);
	}

	private async verifyCachedBuckets(
		requests: readonly Request<BucketRequestMeta>[],
		concurrency: number
	): Promise<Result<readonly Request<BucketRequestMeta>[], QueueError>> {
		const missingRequests: Request<BucketRequestMeta>[] = [];
		let cursor = 0;
		let firstError: QueueError | null = null;

		const workerCount = Math.min(Math.max(concurrency, 1), requests.length);
		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (firstError === null) {
					const request = requests[cursor];
					cursor++;
					if (request === undefined) return;

					const cachedStream = await this.bucketCache.getReadStream(
						request.meta.hash
					);
					if (cachedStream === null) {
						missingRequests.push(request);
						continue;
					}

					const verifyResult = await this.verifyCachedBucket(
						cachedStream,
						request
					);
					if (verifyResult.isErr()) {
						await this.bucketCache.remove(request.meta.hash);
						firstError = verifyResult.error;
					}
				}
			})
		);

		if (firstError !== null) return err(firstError);
		return ok(missingRequests);
	}

	private async verifyCachedBucket(
		readStream: stream.Readable,
		request: Request<BucketRequestMeta>
	): Promise<Result<void, QueueError>> {
		const zlib = createGunzip();
		const hasher = createHash('sha256');

		try {
			await pipeline(readStream, zlib, hasher);
			if (hasher.digest('hex') === request.meta.hash) return ok(undefined);
			return err(
				new QueueError(
					request,
					new ScanError(
						ScanErrorType.TYPE_VERIFICATION,
						request.url.value,
						'Cached bucket hash mismatch'
					)
				)
			);
		} catch (error: unknown) {
			return err(new RetryableQueueError(request, mapUnknownToError(error)));
		}
	}

	private async filterCachedBucketRequests(
		requests: readonly Request<BucketRequestMeta>[],
		concurrency: number
	): Promise<Result<readonly Request<BucketRequestMeta>[], QueueError>> {
		const missingRequests: Request<BucketRequestMeta>[] = [];
		let cursor = 0;
		let firstError: QueueError | null = null;
		const workerCount = Math.min(Math.max(concurrency, 1), requests.length);

		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (firstError === null) {
					const request = requests[cursor];
					cursor++;
					if (request === undefined) return;

					const cachedStream = await this.bucketCache.getReadStream(
						request.meta.hash
					);
					if (cachedStream === null) {
						missingRequests.push(request);
						continue;
					}

					cachedStream.destroy();
				}
			})
		);

		if (firstError !== null) return err(firstError);
		return ok(missingRequests);
	}
}
