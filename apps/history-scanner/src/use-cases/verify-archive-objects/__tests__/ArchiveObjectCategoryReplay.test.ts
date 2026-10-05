import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { ExceptionLogger } from 'exception-logger';
import type { HttpService } from 'http-helper';
import type { HistoryArchiveReusableContentV1 } from 'shared';
import type {
	HistoryArchiveObjectJobDTO,
	ScanCoordinatorService
} from '../../../domain/scan/ScanCoordinatorService.js';
import { HistoryArchiveStateValidator } from '../../../domain/history-archive/HistoryArchiveStateValidator.js';
import type { HasherPool } from '../../../domain/scanner/HasherPool.js';
import { ArchiveXdrError } from '../../../domain/scanner/hash-worker.js';
import { ArchiveObjectCategoryVerifier } from '../ArchiveObjectCategoryVerifier.js';
import { archiveObjectCompressedReplayLimit } from '../ArchiveObjectCompressedReplay.js';

const record = Buffer.from([1, 2, 3, 4]);
const payload = Buffer.from([0x80, 0, 0, 4, ...record]);
const compressed = gzipSync(payload);
const digest = createHash('sha256').update(payload).digest('hex');
const job: HistoryArchiveObjectJobDTO = {
	archiveUrl: 'https://target.example/archive',
	bucketHash: null,
	checkpointLedger: 63,
	claimAttempt: 2,
	objectKey: 'scp:0000003f',
	objectType: 'scp',
	objectUrl: 'https://target.example/archive/scp/00/00/00/scp-0000003f.xdr.gz',
	remoteId: '479c2354-45a8-40c9-8ce0-ec385fa5ae56'
};

describe('category reuse memory fallback', () => {
	it('keeps hits on one GET without invoking the parser', async () => {
		const test = setup();
		test.coordinator.getHistoryArchiveContentReuse.mockResolvedValue(
			ok(artifact())
		);
		const result = (await test.verify())._unsafeUnwrap();
		expect(result.contentReuse).toBeDefined();
		expect(test.createPool).not.toHaveBeenCalled();
		expect(test.http.get).toHaveBeenCalledTimes(1);
		expect(result.bytesDownloaded).toBe(compressed.length);
		test.assertReleased(1);
	});
	it.each(['miss', 'timeout', 'mismatch'] as const)(
		'parses the same captured bytes on %s without another GET/permit',
		async (mode) => {
			const test = setup();
			test.coordinator.getHistoryArchiveContentReuse.mockResolvedValue(
				mode === 'timeout'
					? err(new Error('lookup timed out'))
					: ok(
							mode === 'mismatch'
								? { ...artifact(), contentDigest: 'f'.repeat(64) }
								: null
						)
			);
			const result = (await test.verify())._unsafeUnwrap();
			expect(result.contentReuse).toBeUndefined();
			expect(test.http.get).toHaveBeenCalledTimes(1);
			expect(test.parse).toHaveBeenCalledWith('processScpHistoryEntryXDR', [
				record
			]);
			expect(result.verificationFacts).toMatchObject({
				content: { digest },
				scpCategory: { entryCount: 1, sourceUrl: job.objectUrl }
			});
			expect(result.bytesDownloaded).toBe(compressed.length);
			expect(
				test.progress.mock.calls.filter((call) => call[1] === 'fetching_scp')
			).toHaveLength(1);
			test.assertReleased(1);
		}
	);
	it('falls back on overflow with bounded capture and accounts for both real downloads', async () => {
		const large = gzipSync(
			randomBytes(archiveObjectCompressedReplayLimit + 128)
		);
		expect(large.length).toBeGreaterThan(archiveObjectCompressedReplayLimit);
		const test = setup([large, compressed]);
		const result = (await test.verify())._unsafeUnwrap();
		expect(test.http.get).toHaveBeenCalledTimes(2);
		expect(result.bytesDownloaded).toBe(large.length + compressed.length);
		expect(result.verificationFacts?.content?.digest).toBe(digest);
		test.assertReleased(2);
	});
	it('owns its captured bytes after the original response and HTTP permit are released', async () => {
		const original = Buffer.from(compressed);
		const test = setup([original]);
		test.coordinator.getHistoryArchiveContentReuse.mockImplementation(
			async () => {
				test.assertReleased(1);
				original.fill(0);
				return ok(null);
			}
		);
		test.parse.mockImplementation(async () => {
			test.assertReleased(1);
		});
		const result = (await test.verify())._unsafeUnwrap();
		expect(test.parse).toHaveBeenCalledWith('processScpHistoryEntryXDR', [
			record
		]);
		expect(result.verificationFacts?.content?.digest).toBe(digest);
		expect(result.bytesDownloaded).toBe(compressed.length);
		expect(test.http.get).toHaveBeenCalledTimes(1);
	});
	it('never looks up or parses corrupt gzip and releases the permit', async () => {
		const test = setup([Buffer.from('corrupt gzip')]);
		expect((await test.verify())._unsafeUnwrapErr().failureChannel).toBe(
			'archive_evidence'
		);
		expect(
			test.coordinator.getHistoryArchiveContentReuse
		).not.toHaveBeenCalled();
		expect(test.createPool).not.toHaveBeenCalled();
		expect(test.http.get).toHaveBeenCalledTimes(1);
		test.assertReleased(1);
	});
	it('does not convert a captured XDR verification failure into success', async () => {
		const test = setup();
		test.parse.mockRejectedValue(new ArchiveXdrError('invalid XDR'));
		expect((await test.verify())._unsafeUnwrapErr().failureChannel).toBe(
			'archive_evidence'
		);
		expect(test.http.get).toHaveBeenCalledTimes(1);
		test.assertReleased(1);
	});
	it('releases its permit on interrupted source without replaying a partial capture', async () => {
		const test = setup();
		test.http.get.mockResolvedValue(
			ok({
				data: Readable.from(
					(async function* () {
						yield compressed.subarray(0, 8);
						throw new Error('aborted');
					})()
				),
				headers: {},
				status: 200,
				statusText: 'OK'
			})
		);
		expect((await test.verify()).isErr()).toBe(true);
		expect(
			test.coordinator.getHistoryArchiveContentReuse
		).not.toHaveBeenCalled();
		expect(test.createPool).not.toHaveBeenCalled();
		test.assertReleased(1);
	});
});

function setup(bodies: readonly Buffer[] = [compressed]) {
	const http = mock<HttpService>();
	let next = 0;
	http.get.mockImplementation(async () => {
		const body = bodies[next++];
		if (body === undefined) throw new Error('unexpected second GET');
		return ok({
			data: Readable.from(body),
			headers: { 'content-length': String(body.length) },
			status: 200,
			statusText: 'OK'
		});
	});
	const coordinator = mock<ScanCoordinatorService>();
	coordinator.getHistoryArchiveContentReuse.mockResolvedValue(ok(null));
	const parse = jest.fn().mockResolvedValue(undefined);
	const createPool = jest.fn(
		() =>
			({
				terminated: false,
				workerpool: {
					exec: parse,
					terminate: jest.fn().mockResolvedValue(undefined)
				}
			}) as unknown as HasherPool
	);
	let held = 0;
	let released = 0;
	const acquire = jest.fn(async () => {
		held++;
		let active = true;
		return () => {
			if (active) {
				active = false;
				held--;
				released++;
			}
		};
	});
	const progress = jest.fn();
	const verifier = new ArchiveObjectCategoryVerifier(
		http,
		coordinator,
		mock<HistoryArchiveStateValidator>(),
		mock<ExceptionLogger>(),
		1,
		progress,
		async () => undefined,
		{ acquire },
		true,
		createPool
	);
	return {
		http,
		coordinator,
		parse,
		createPool,
		progress,
		verify: async () => {
			try {
				return await verifier.verifyCategoryObject(
					job,
					undefined,
					'cc9dbd5b-757d-476d-9316-a68d6278c813'
				);
			} finally {
				await verifier.close();
			}
		},
		assertReleased: (expected: number) => {
			expect(acquire).toHaveBeenCalledTimes(expected);
			expect(held).toBe(0);
			expect(released).toBe(expected);
		}
	};
}

function artifact(): HistoryArchiveReusableContentV1 {
	return {
		artifactId: 'a061c878-8bd7-4c81-981a-8bb88a72291c',
		sourceObjectRemoteId: 'd8266316-9e31-4bd5-8b60-dcc90f4b631c',
		contentDigest: digest,
		contentRepresentation: 'uncompressed-xdr',
		derivationVersion: 1,
		verificationFacts: {
			content: {
				algorithm: 'sha256',
				digest,
				representation: 'uncompressed-xdr'
			},
			scpCategory: { entryCount: 1, sourceUrl: job.objectUrl }
		}
	};
}
