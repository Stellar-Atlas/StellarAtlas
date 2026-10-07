import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { HistoryArchiveReusableContentV2 } from 'shared';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import { ArchiveObjectContentReuseVerifier } from '../ArchiveObjectContentReuseVerifier.js';

const remoteId = '277d58a0-0185-4c94-90ec-cbfd4e3ad2d4';
const sourceId = 'f84ee265-b3ac-43ca-b55e-7cc3bb086e54';
const executionId = '06161c4e-c064-408a-9f98-6feb15f2db08';
const artifactId = 'aeec1320-3a25-4bc3-b616-2e37bc2e98be';
// Deliberately not XDR: a warm exact-digest result must not reparse it.
const payload = Buffer.from('independently downloaded uncompressed bytes');
const digest = createHash('sha256').update(payload).digest('hex');
const compressed = gzipSync(payload);

describe('ArchiveObjectContentReuseVerifier compact-v2', () => {
	it.each(['ledger', 'transactions', 'results'] as const)(
		'uses a bound %s summary without arrays or reparse',
		async (objectType) => {
			const job = createJob(objectType);
			const fixture = createFixture(compact(job));
			const onMiss = jest.fn();
			const result = (
				await fixture.verifier.tryReuse(job, executionId, jest.fn(), onMiss)
			)._unsafeUnwrap();
			expect(result).toEqual({
				bytesDownloaded: compressed.length,
				contentReuse: {
					artifactId,
					contentDigest: digest,
					contentRepresentation: 'uncompressed-xdr',
					derivationVersion: 1,
					sourceObjectRemoteId: sourceId
				},
				workerStage: 'verified'
			});
			expect(result).not.toHaveProperty('verificationFacts');
			expect(onMiss).not.toHaveBeenCalled();
			expect(fixture.http.get).toHaveBeenCalledTimes(1);
			expect(
				fixture.coordinator.getHistoryArchiveContentReuse
			).toHaveBeenCalledWith(
				expect.objectContaining({
					responseFormat: 'compact-v2',
					contentDigest: digest,
					remoteId,
					executionId,
					claimAttempt: 2
				})
			);
		}
	);

	const mismatches: readonly [
		string,
		(value: HistoryArchiveReusableContentV2) => HistoryArchiveReusableContentV2
	][] = [
		[
			'target object',
			(value) => ({
				...value,
				binding: { ...value.binding, remoteId: sourceId }
			})
		],
		[
			'execution',
			(value) => ({
				...value,
				binding: { ...value.binding, executionId: sourceId }
			})
		],
		[
			'attempt',
			(value) => ({ ...value, binding: { ...value.binding, claimAttempt: 3 } })
		],
		[
			'category',
			(value) => ({
				...value,
				binding: { ...value.binding, objectType: 'results' }
			})
		],
		[
			'key',
			(value) => ({
				...value,
				binding: { ...value.binding, objectKey: 'ledger:0000007f' }
			})
		],
		[
			'checkpoint',
			(value) => ({
				...value,
				binding: { ...value.binding, checkpointLedger: 127 }
			})
		],
		[
			'source URL',
			(value) => ({
				...value,
				binding: {
					...value.binding,
					sourceUrl: 'https://other.example/ledger.gz'
				}
			})
		],
		[
			'downloaded digest',
			(value) => ({ ...value, contentDigest: '0'.repeat(64) })
		]
	];
	it.each(mismatches)(
		'falls back with the same downloaded spool on mismatched %s',
		async (_name, mutate) => {
			const job = createJob('ledger');
			const fixture = createFixture(mutate(compact(job)));
			const onMiss = jest.fn();
			const result = await fixture.verifier.tryReuse(
				job,
				executionId,
				jest.fn(),
				onMiss
			);
			expect(result._unsafeUnwrap()).toBeNull();
			expect(onMiss).toHaveBeenCalledWith(
				expect.objectContaining({
					compressed,
					bytesDownloaded: compressed.length
				})
			);
			expect(fixture.logger.captureException).toHaveBeenCalledTimes(1);
			expect(fixture.http.get).toHaveBeenCalledTimes(1);
		}
	);

	it('does not request compact summaries for SCP', async () => {
		const fixture = createFixture(null);
		const job: HistoryArchiveObjectJobDTO = {
			...createJob('ledger'),
			objectType: 'scp',
			objectKey: 'scp:0000003f'
		};
		expect(
			(
				await fixture.verifier.tryReuse(job, executionId, jest.fn())
			)._unsafeUnwrap()
		).toBeNull();
		expect(
			fixture.coordinator.getHistoryArchiveContentReuse
		).toHaveBeenCalledWith(
			expect.not.objectContaining({ responseFormat: expect.anything() })
		);
	});

	it('accepts an exact empty transaction summary without fabricating empty facts', async () => {
		const job = createJob('transactions');
		const value = compact(job);
		const fixture = createFixture({
			...value,
			summary: {
				entryCount: 0,
				ledgerCount: 0,
				firstLedger: null,
				lastLedger: null
			}
		});
		const result = (
			await fixture.verifier.tryReuse(job, executionId, jest.fn())
		)._unsafeUnwrap();
		expect(result?.contentReuse?.artifactId).toBe(artifactId);
		expect(result).not.toHaveProperty('verificationFacts');
	});
});

function createJob(
	objectType: 'ledger' | 'transactions' | 'results'
): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://target.example/archive',
		bucketHash: null,
		checkpointLedger: 63,
		claimAttempt: 2,
		objectKey: `${objectType}:0000003f`,
		objectType,
		objectUrl: `https://target.example/archive/${objectType}/0000003f.xdr.gz`,
		remoteId
	};
}

function compact(
	job: HistoryArchiveObjectJobDTO
): HistoryArchiveReusableContentV2 {
	if (
		job.objectType !== 'ledger' &&
		job.objectType !== 'transactions' &&
		job.objectType !== 'results'
	)
		throw new Error('Unsupported test category');
	return {
		artifactId,
		contentDigest: digest,
		contentRepresentation: 'uncompressed-xdr',
		derivationVersion: 1,
		sourceObjectRemoteId: sourceId,
		format: 'compact-v2',
		binding: {
			remoteId,
			executionId,
			claimAttempt: job.claimAttempt,
			objectType: job.objectType,
			objectKey: job.objectKey,
			checkpointLedger: 63,
			sourceUrl: job.objectUrl
		},
		summary: {
			entryCount: 64,
			ledgerCount: 64,
			firstLedger: 0,
			lastLedger: 63,
			...(job.objectType === 'ledger' ? { headerHashesVerified: true } : {})
		}
	};
}

function createFixture(response: HistoryArchiveReusableContentV2 | null) {
	const http = mock<HttpService>();
	http.get.mockResolvedValue(
		ok({
			data: Readable.from(compressed),
			headers: { 'content-length': String(compressed.length) },
			status: 200,
			statusText: 'OK'
		})
	);
	const coordinator = mock<ScanCoordinatorService>();
	coordinator.getHistoryArchiveContentReuse.mockResolvedValue(ok(response));
	const logger = mock<ExceptionLogger>();
	const verifier = new ArchiveObjectContentReuseVerifier(
		http,
		coordinator,
		logger,
		() => undefined,
		async () => undefined,
		{ acquire: async () => () => undefined }
	);
	return { http, coordinator, logger, verifier };
}
