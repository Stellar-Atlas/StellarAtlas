import 'reflect-metadata';
import { Readable } from 'node:stream';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { HttpError, type HttpService } from 'http-helper';
import type { ExceptionLogger } from 'exception-logger';
import type { Logger } from 'logger';
import type { HistoryArchiveObjectJobDTO } from '../../../domain/scan/ScanCoordinatorService.js';
import type { ScanCoordinatorService } from '../../../domain/scan/ScanCoordinatorService.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import { ArchiveXdrError } from '../../../domain/scanner/hash-worker.js';
import { ScannerIssueError } from '../../../domain/scanner/ScannerIssueError.js';
import {
	ArchiveObjectCategoryVerifier
} from '../ArchiveObjectCategoryVerifier.js';
import { classifyCategoryVerificationFailure } from '../ArchiveObjectCategoryFailureClassifier.js';

describe('ArchiveObjectCategoryVerifier', () => {
	it('preserves HTTP status on category fetch failures', async () => {
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			err(
				new HttpError('Request failed with status code 403', undefined, {
					data: {},
					headers: {},
					status: 403,
					statusText: 'Forbidden'
				})
			)
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			mock<HistoryArchiveStateValidator>(),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCategoryObject(createObjectJob());

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toMatchObject({
				errorType: 'archive_http_error',
				failureChannel: 'archive_evidence',
				httpStatus: 403
			});
		}
	});

	it('returns checkpoint history archive state facts for checkpoint objects', async () => {
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			ok({
				data: createHistoryArchiveState(),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			new HistoryArchiveStateValidator(mock<Logger>()),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCheckpointState(
			createObjectJob({
				checkpointLedger: 127,
				objectKey: 'checkpoint-state:0000007f',
				objectType: 'checkpoint-state',
				objectUrl:
					'https://archive.example/history/00/00/00/history-0000007f.json'
			})
		);

		expect(result._unsafeUnwrap()).toMatchObject({
			bytesDownloaded: expect.any(Number),
			verificationFacts: {
				content: {
					algorithm: 'sha256',
					digest: expect.stringMatching(/^[0-9a-f]{64}$/),
					representation: 'canonical-json'
				},
				checkpointHistoryArchiveStateFact: {
					bucketListHash: expect.any(String),
					checkpointLedger: 127,
					stellarHistoryUrl:
						'https://archive.example/history/00/00/00/history-0000007f.json'
				},
				checkpointHistoryArchiveState: {
					stellarHistory: { currentLedger: 127 },
					stellarHistoryUrl:
						'https://archive.example/history/00/00/00/history-0000007f.json'
				}
			},
			workerStage: 'verified'
		});
	});

	it('rejects checkpoint state that declares a different checkpoint ledger', async () => {
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			ok({
				data: createHistoryArchiveState(),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			new HistoryArchiveStateValidator(mock<Logger>()),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCheckpointState(
			createObjectJob({ objectType: 'checkpoint-state' })
		);

		expect(result._unsafeUnwrapErr()).toMatchObject({
			errorType: 'checkpoint_state_ledger_mismatch',
			failureChannel: 'archive_evidence',
			httpStatus: 200,
			verificationFacts: {
				checkpointHistoryArchiveStateFact: {
					checkpointLedger: 127,
					stellarHistoryUrl: expect.any(String)
				}
			}
		});
	});

	it('classifies malformed remote XDR separately from worker failures', () => {
		expect(
			classifyCategoryVerificationFailure(
				new ArchiveXdrError('Invalid ledger header archive XDR'),
				200
			)
		).toMatchObject({
			errorType: 'category_content_invalid',
			failureChannel: 'archive_evidence',
			httpStatus: 200
		});
		expect(
			classifyCategoryVerificationFailure(
				new ScannerIssueError('Worker pool terminated'),
				200
			)
		).toMatchObject({
			errorType: 'category_scanner_failure',
			failureChannel: 'scanner_issue',
			httpStatus: null
		});
		expect(
			classifyCategoryVerificationFailure(
				Object.assign(new Error('premature close'), {
					code: 'ERR_STREAM_PREMATURE_CLOSE'
				}),
				200
			)
		).toMatchObject({
			errorType: 'archive_transport_error',
			failureChannel: 'archive_evidence',
			httpStatus: 200
		});
		expect(
			classifyCategoryVerificationFailure(
				new Error('outer', {
					cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' })
				}),
				200
			)
		).toMatchObject({ errorType: 'archive_transport_error' });
		expect(
			classifyCategoryVerificationFailure(new Error('unknown pipeline error'), 200)
		).toMatchObject({
			errorType: 'category_pipeline_failure',
			failureChannel: 'scanner_issue',
			httpStatus: null
		});
	});

	it('classifies a mid-stream source reset as transport evidence', async () => {
		const reset = Object.assign(new Error('remote stream reset'), {
			code: 'ECONNRESET'
		});
		const stream = Readable.from(
			(async function* () {
				yield Buffer.from([0x1f, 0x8b]);
				throw reset;
			})()
		);
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			ok({ data: stream, headers: {}, status: 200, statusText: 'OK' })
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			mock<HistoryArchiveStateValidator>(),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCategoryObject(createObjectJob());

		expect(result._unsafeUnwrapErr()).toMatchObject({
			errorType: 'archive_transport_error',
			failureChannel: 'archive_evidence',
			httpStatus: 200
		});
	});

	it('classifies a complete malformed gzip response as content evidence', async () => {
		const httpService = mock<HttpService>();
		httpService.get.mockResolvedValue(
			ok({
				data: Readable.from([Buffer.from('not-a-gzip-stream')]),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);
		const verifier = new ArchiveObjectCategoryVerifier(
			httpService,
			mock<ScanCoordinatorService>(),
			mock<HistoryArchiveStateValidator>(),
			mock<ExceptionLogger>(),
			1,
			() => undefined
		);

		const result = await verifier.verifyCategoryObject(createObjectJob());

		expect(result._unsafeUnwrapErr()).toMatchObject({
			errorType: 'category_content_invalid',
			failureChannel: 'archive_evidence',
			httpStatus: 200
		});
	});
});

function createObjectJob(
	overrides: Partial<HistoryArchiveObjectJobDTO> = {}
): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://archive.example',
		bucketHash: null,
		checkpointLedger: 63,
		claimAttempt: 1,
		objectKey: 'ledger:0000003f',
		objectType: 'ledger',
		objectUrl: 'https://archive.example/ledger/00/00/00/ledger-0000003f.xdr.gz',
		remoteId: 'object-1',
		...overrides
	};
}

function createHistoryArchiveState(): Record<string, unknown> {
	return {
		currentBuckets: [
			{
				curr: '4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
				next: { state: 0 },
				snap: '0000000000000000000000000000000000000000000000000000000000000000'
			}
		],
		currentLedger: 127,
		server: 'stellar-core',
		version: 1
	};
}
