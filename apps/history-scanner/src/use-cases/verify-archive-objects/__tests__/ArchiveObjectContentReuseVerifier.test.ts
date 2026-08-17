import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import { ArchiveObjectContentReuseVerifier } from '../ArchiveObjectContentReuseVerifier.js';

const targetRemoteId = '277d58a0-0185-4c94-90ec-cbfd4e3ad2d4';
const sourceRemoteId = 'f84ee265-b3ac-43ca-b55e-7cc3bb086e54';
const artifactId = 'aeec1320-3a25-4bc3-b616-2e37bc2e98be';
const executionId = '06161c4e-c064-408a-9f98-6feb15f2db08';
const payload = Buffer.from('canonical ledger xdr payload');
const compressed = gzipSync(payload);
const digest = createHash('sha256').update(payload).digest('hex');

describe('ArchiveObjectContentReuseVerifier', () => {
	it('hashes one source stream and returns exact reusable facts without parsing', async () => {
		const httpService = createHttpService(compressed);
		const coordinator = mock<ScanCoordinatorService>();
		coordinator.getHistoryArchiveContentReuse.mockResolvedValue(
			ok(reusableContent(createJob().objectUrl))
		);
		const release = jest.fn();
		const verifier = createVerifier(httpService, coordinator);

		const result = await verifier.tryReuse(createJob(), executionId, release);

		expect(result._unsafeUnwrap()).toMatchObject({
			bytesDownloaded: compressed.length,
			contentReuse: {
				artifactId,
				contentDigest: digest,
				sourceObjectRemoteId: sourceRemoteId
			},
			verificationFacts: {
				content: { digest },
				ledgerCategory: { sourceUrl: createJob().objectUrl }
			},
			workerStage: 'verified'
		});
		expect(coordinator.getHistoryArchiveContentReuse).toHaveBeenCalledWith({
			claimAttempt: 2,
			contentDigest: digest,
			contentRepresentation: 'uncompressed-xdr',
			derivationVersion: 1,
			executionId,
			objectKey: 'ledger:0000003f',
			objectType: 'ledger',
			remoteId: targetRemoteId
		});
		expect(httpService.get).toHaveBeenCalledTimes(1);
		expect(release).toHaveBeenCalled();
	});

	it('returns an optimization miss after hashing when no artifact exists', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		coordinator.getHistoryArchiveContentReuse.mockResolvedValue(ok(null));
		const verifier = createVerifier(createHttpService(compressed), coordinator);

		const result = await verifier.tryReuse(createJob(), executionId, jest.fn());

		expect(result._unsafeUnwrap()).toBeNull();
		expect(coordinator.getHistoryArchiveContentReuse).toHaveBeenCalledTimes(1);
	});

	it('fails closed to canonical parsing when coordinator facts mismatch the target', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		coordinator.getHistoryArchiveContentReuse.mockResolvedValue(
			ok(reusableContent('https://wrong.example/ledger.xdr.gz'))
		);
		const exceptionLogger = mock<ExceptionLogger>();
		const verifier = createVerifier(
			createHttpService(compressed),
			coordinator,
			exceptionLogger
		);

		const result = await verifier.tryReuse(createJob(), executionId, jest.fn());

		expect(result._unsafeUnwrap()).toBeNull();
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(
			expect.objectContaining({
				message: 'Coordinator returned mismatched reusable archive content'
			})
		);
	});

	it('reports corrupt gzip as archive evidence and never requests reuse', async () => {
		const coordinator = mock<ScanCoordinatorService>();
		const verifier = createVerifier(
			createHttpService(Buffer.from('not gzip')),
			coordinator
		);

		const result = await verifier.tryReuse(createJob(), executionId, jest.fn());

		expect(result._unsafeUnwrapErr()).toMatchObject({
			failureChannel: 'archive_evidence'
		});
		expect(coordinator.getHistoryArchiveContentReuse).not.toHaveBeenCalled();
	});
});

function createVerifier(
	httpService: HttpService,
	coordinator: ScanCoordinatorService,
	exceptionLogger: ExceptionLogger = mock<ExceptionLogger>()
): ArchiveObjectContentReuseVerifier {
	return new ArchiveObjectContentReuseVerifier(
		httpService,
		coordinator,
		exceptionLogger,
		() => undefined,
		async () => undefined,
		{ acquire: async () => () => undefined }
	);
}

function createHttpService(data: Buffer): HttpService {
	const httpService = mock<HttpService>();
	httpService.get.mockResolvedValue(
		ok({
			data: Readable.from(data),
			headers: { 'content-length': String(data.length) },
			status: 200,
			statusText: 'OK'
		})
	);
	return httpService;
}

function createJob(): HistoryArchiveObjectJobDTO {
	return {
		archiveUrl: 'https://target.example/archive',
		bucketHash: null,
		checkpointLedger: 63,
		claimAttempt: 2,
		objectKey: 'ledger:0000003f',
		objectType: 'ledger',
		objectUrl:
			'https://target.example/archive/ledger/00/00/00/ledger-0000003f.xdr.gz',
		remoteId: targetRemoteId
	};
}

function reusableContent(sourceUrl: string) {
	return {
		artifactId,
		contentDigest: digest,
		contentRepresentation: 'uncompressed-xdr' as const,
		derivationVersion: 1 as const,
		sourceObjectRemoteId: sourceRemoteId,
		verificationFacts: {
			content: {
				algorithm: 'sha256' as const,
				digest,
				representation: 'uncompressed-xdr' as const
			},
			ledgerCategory: {
				entryCount: 1,
				headerHashesVerified: true as const,
				ledgers: [
					{
						bucketListHash: 'a'.repeat(64),
						ledger: 63,
						ledgerHeaderHash: 'b'.repeat(64),
						previousLedgerHeaderHash: 'c'.repeat(64),
						protocolVersion: 23,
						transactionResultSetHash: 'd'.repeat(64),
						transactionSetHash: 'e'.repeat(64)
					}
				],
				sourceUrl
			}
		}
	};
}
