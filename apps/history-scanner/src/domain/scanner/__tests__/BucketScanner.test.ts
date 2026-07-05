import * as fs from 'fs';
import * as path from 'path';
import { mock } from 'jest-mock-extended';
import { HttpQueue, QueueError, RequestMethod } from 'http-helper';
import { Result } from 'neverthrow';
import { createDummyHistoryBaseUrl } from '../../history-archive/__fixtures__/HistoryBaseUrl.js';
import { BucketScanner } from '../BucketScanner.js';
import { BucketScanState } from '../ScanState.js';
import * as http from 'http';
import * as https from 'https';
import { ScanError, ScanErrorType } from '../../scan/ScanError.js';
import { fileURLToPath } from 'node:url';
import { BucketCache } from '../BucketCache.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

it('should verify the bucket hash', async function () {
	const bucketPath = path.join(currentDir, '../__fixtures__/bucket.xdr.gz');

	const stream = await fs.createReadStream(bucketPath);
	const httpQueue = mock<HttpQueue>();
	httpQueue.sendRequests.mockImplementation(
		async (urls, options, resultHandler): Promise<Result<void, QueueError>> => {
			if (!resultHandler) throw new Error('No result handler');
			const result = await resultHandler(stream, {
				url: createDummyHistoryBaseUrl(),
				meta: {
					hash: 'fed2affac90580353d1d7845194ecedea42363219c27e0e0788d48b6c739962a'
				} as any,
				method: RequestMethod.GET
			});
			return new Promise((resolve) => resolve(result));
		}
	);

	const scanner = new BucketScanner(httpQueue, createBucketCacheMock());

	const result = await scan(
		{
			baseUrl: createDummyHistoryBaseUrl(),
			concurrency: 1,
			httpAgent: {} as http.Agent,
			httpsAgent: {} as https.Agent,
			bucketHashesToScan: new Set([
				'fed2affac90580353d1d7845194ecedea42363219c27e0e0788d48b6c739962a'
			])
		},
		scanner
	);
	expect(result.isOk()).toBeTruthy();
});

it('should return verification error when zip archive is corrupt', async function () {
	const bucketPath = path.join(
		currentDir,
		'../__fixtures__/bucket_empty.xdr.gz'
	);

	const stream = await fs.createReadStream(bucketPath);
	const httpQueue = mock<HttpQueue>();
	httpQueue.sendRequests.mockImplementation(
		async (urls, options, resultHandler): Promise<Result<void, QueueError>> => {
			if (!resultHandler) throw new Error('No result handler');
			const result = await resultHandler(stream, {
				url: createDummyHistoryBaseUrl(),
				meta: {
					hash: 'fed2affac90580353d1d7845194ecedea42363219c27e0e0788d48b6c739962a'
				} as any,
				method: RequestMethod.GET
			});
			return new Promise((resolve) => resolve(result));
		}
	);
	const scanner = new BucketScanner(httpQueue, createBucketCacheMock());

	const result = await scan(
		{
			baseUrl: createDummyHistoryBaseUrl(),
			concurrency: 1,
			httpAgent: {} as http.Agent,
			httpsAgent: {} as https.Agent,
			bucketHashesToScan: new Set([
				'fed2affac90580353d1d7845194ecedea42363219c27e0e0788d48b6c739962a'
			])
		},
		scanner
	);
	expect(result.isErr()).toBeTruthy();
	if (!result.isErr()) throw Error();
	expect(result.error).toBeInstanceOf(ScanError);
	expect(result.error.type).toEqual(ScanErrorType.TYPE_VERIFICATION);
});

const scan = async (scanState: BucketScanState, scanner: BucketScanner) => {
	return await scanner.scan(scanState, true);
};

const createBucketCacheMock = () => {
	const bucketCache = mock<BucketCache>();
	bucketCache.getReadStream.mockResolvedValue(null);
	bucketCache.verifyAndStore.mockImplementation(async (_hash, source, verify) =>
		verify(source)
	);
	return bucketCache;
};
