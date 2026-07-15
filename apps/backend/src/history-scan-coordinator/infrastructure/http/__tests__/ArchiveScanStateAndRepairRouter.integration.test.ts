import express from 'express';
import { Readable } from 'node:stream';
import request from 'supertest';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import {
	ArchiveScanRouterWrapper,
	type ArchiveScanRouterConfig
} from '../ArchiveScanRouter.js';

describe('ArchiveScanRouter state and repair endpoints', () => {
	const bucketHash =
		'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655';
	let app: express.Application;
	let config: DeepMockProxy<ArchiveScanRouterConfig>;

	beforeEach(() => {
		config = mockDeep<ArchiveScanRouterConfig>();
		app = express();
		app.use('/archive-scans', ArchiveScanRouterWrapper(config));
	});

	it('exposes archive repair actions', async () => {
		config.getHistoryArchiveRepairPlan.execute.mockResolvedValue(
			ok({
				actionCount: 1,
				actions: [
					{
						actionId:
							'replace-bucket-file:11111111-1111-4111-8111-111111111111',
						bucketHash:
							'4eae73efaa0ce061441dfe43ffc61c0ed24fcbc59e5ee512d1b60e8da2509655',
						checkpointEvidence: [],
						checkpointLedger: 63355999,
						evidence: [],
						kind: 'replace-bucket-file',
						knownGoodSources: [],
						reason: 'bucket-hash-mismatch',
						repairArtifact: {
							artifactType: 'bucket',
							contentHash: {
								algorithm: 'sha256',
								digest: bucketHash,
								representation: 'uncompressed-xdr'
							},
							objectIdentity: `bucket:${bucketHash}`,
							reason: 'local-payload-missing',
							retry: { afterSeconds: 60, retryable: true },
							status: 'unavailable'
						},
						severity: 'error',
						summary:
							'Replace the bucket file with bytes that match the expected bucket hash.'
					}
				],
				archiveUrl: 'https://history.example.com',
				archiveUrlIdentity: 'https://history.example.com',
				generatedAt: '2026-07-07T18:00:00.000Z',
				infrastructureBlocks: [],
				limit: 5,
				summary: {
					activeObjectChecks: 0,
					failedCheckpointProofs: 1,
					failedObjectChecks: 1,
					pendingObjectChecks: 0,
					verifiedObjectChecks: 10
				}
			})
		);

		await request(app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/repair-plan?limit=5'
			)
			.expect(200)
			.expect((response) => {
				expect(response.headers.deprecation).toBeUndefined();
			})
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.actions[0]).toMatchObject({
					kind: 'replace-bucket-file',
					reason: 'bucket-hash-mismatch'
				});
			});
		expect(config.getHistoryArchiveRepairPlan.execute).toHaveBeenCalledWith({
			limit: 5,
			url: 'https://history.example.com'
		});
	});

	it('rejects invalid repair plan limits', async () => {
		await request(app)
			.get(
				'/archive-scans/https%3A%2F%2Fhistory.example.com/repair-plan?limit=9999'
			)
			.expect(400);
		expect(config.getHistoryArchiveRepairPlan.execute).not.toHaveBeenCalled();
	});

	it('streams only an exact locally proven repair artifact', async () => {
		const payload = Buffer.from('proven compressed bucket bytes');
		const close = jest.fn(async () => undefined);
		config.getHistoryArchiveRepairArtifact.execute.mockResolvedValue({
			artifact: {
				artifactType: 'bucket',
				byteLength: payload.byteLength,
				contentHash: {
					algorithm: 'sha256',
					digest: bucketHash,
					representation: 'uncompressed-xdr'
				},
				downloadUrl: `/v1/archive-scans/repair-artifacts/buckets/${bucketHash}`,
				mediaType: 'application/gzip',
				objectIdentity: `bucket:${bucketHash}`,
				provenAt: '2026-07-07T18:00:00.000Z',
				status: 'available'
			},
			close,
			fileName: `bucket-${bucketHash}.xdr.gz`,
			status: 'available',
			stream: Readable.from(payload)
		});

		const response = await request(app)
			.get(`/archive-scans/repair-artifacts/buckets/${bucketHash}`)
			.buffer(true)
			.parse(binaryParser)
			.expect(200)
			.expect('Content-Type', 'application/gzip')
			.expect('X-Stellar-Bucket-Hash', bucketHash)
			.expect('Cache-Control', 'public, max-age=31536000, immutable');

		expect(response.body).toEqual(payload);
		expect(close).toHaveBeenCalledTimes(1);
	});

	it.each([
		['local-payload-missing', 404],
		['content-hash-mismatch', 409]
	] as const)('returns structured %s evidence', async (reason, status) => {
		config.getHistoryArchiveRepairArtifact.execute.mockResolvedValue({
			artifactType: 'bucket',
			contentHash: {
				algorithm: 'sha256',
				digest: bucketHash,
				representation: 'uncompressed-xdr'
			},
			objectIdentity: `bucket:${bucketHash}`,
			reason,
			retry: { afterSeconds: 60, retryable: true },
			status: 'unavailable'
		});

		const response = await request(app)
			.get(`/archive-scans/repair-artifacts/buckets/${bucketHash}`)
			.expect(status)
			.expect('Cache-Control', 'no-store')
			.expect('Retry-After', '60');

		expect(response.body).toMatchObject({
			reason,
			retry: { afterSeconds: 60, retryable: true },
			status: 'unavailable'
		});
		expect(JSON.stringify(response.body)).not.toContain('/home/');
	});

	it('rejects an encoded traversal attempt with no local path disclosure', async () => {
		config.getHistoryArchiveRepairArtifact.execute.mockResolvedValue({
			artifactType: 'bucket',
			contentHash: null,
			objectIdentity: null,
			reason: 'invalid-object-identity',
			retry: { afterSeconds: null, retryable: false },
			status: 'unavailable'
		});

		const response = await request(app)
			.get('/archive-scans/repair-artifacts/buckets/%2e%2e%2foutside')
			.expect(400);

		expect(
			config.getHistoryArchiveRepairArtifact.execute
		).not.toHaveBeenCalled();
		expect(response.body).toMatchObject({
			reason: 'invalid-object-identity',
			status: 'unavailable'
		});
		expect(JSON.stringify(response.body)).not.toContain('/home/');
	});

	it('exposes scanner-owned history archive state', async () => {
		config.getHistoryArchiveState.execute.mockResolvedValue(
			ok({
				archiveUrl: 'https://test.com',
				archiveUrlIdentity: 'https://test.com',
				failure: null,
				metadata: {
					observedAt: '2026-07-03T10:00:00.000Z',
					stellarHistory: {
						currentBuckets: [],
						currentLedger: 100,
						server: 'stellar-core',
						version: 1
					},
					stellarHistoryUrl: 'https://test.com/.well-known/stellar-history.json'
				},
				observedAt: '2026-07-03T10:00:00.000Z',
				source: 'history-scanner',
				stateUrl: 'https://test.com/.well-known/stellar-history.json',
				status: 'available'
			})
		);

		await request(app)
			.get('/archive-scans/https%3A%2F%2Ftest.com/state')
			.expect(200)
			.expect((response) => {
				expect(response.headers.deprecation).toBeUndefined();
			})
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toMatchObject({
					archiveUrl: 'https://test.com',
					metadata: { stellarHistory: { currentLedger: 100 } },
					status: 'available'
				});
			});
		expect(config.getHistoryArchiveState.execute).toHaveBeenCalledWith(
			'https://test.com'
		);
	});

	it('returns 204 when no scanner-owned state exists yet', async () => {
		config.getHistoryArchiveState.execute.mockResolvedValue(ok(null));
		await request(app)
			.get('/archive-scans/https%3A%2F%2Ftest.com/state')
			.expect(204)
			.expect('Cache-Control', 'public, max-age=10');
	});
});

function binaryParser(
	response: NodeJS.ReadableStream,
	callback: (error: Error | null, body?: Buffer) => void
): void {
	const chunks: Uint8Array[] = [];
	response.on('data', (chunk: unknown) => {
		if (typeof chunk === 'string') chunks.push(Buffer.from(chunk));
		else if (chunk instanceof Uint8Array) chunks.push(chunk);
	});
	response.on('end', () => callback(null, Buffer.concat(chunks)));
	response.on('error', (error: Error) => callback(error));
}
