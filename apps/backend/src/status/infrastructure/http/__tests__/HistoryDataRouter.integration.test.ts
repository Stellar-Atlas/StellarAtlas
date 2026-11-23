import express from 'express';
import request from 'supertest';
import { mock, type MockProxy } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import { mkdir, mkdtemp, open, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { historyDataRouter } from '../HistoryDataRouter.js';
import { checkedHistoryStorageRoot, historyColdReader } from '../HistoryDataColdDownload.js';

describe('HistoryDataRouter.integration', () => {
	let app: express.Application;
	let dataSource: MockProxy<DataSource>;
	let storageRoot: string;

	beforeEach(async () => {
		dataSource = mock<DataSource>();
		storageRoot = await mkdtemp(join(tmpdir(), 'history-data-router-'));
		app = express();
		app.use(
			'/v1/history-data',
			historyDataRouter({
				dataSource,
				networkPassphrase: 'Public Global Stellar Network ; September 2015',
				storageRoot
			})
		);
	});

	afterEach(async () => {
		await rm(storageRoot, { force: true, recursive: true });
	});

	it('reports continuous and supplemental catalog coverage', async () => {
		dataSource.query.mockImplementation(async (sql: string) => {
			if (sql.includes('to_regclass')) return [{ available: false }];
			if (sql.includes('full_history_lcm_dataset_status_rollup')) {
				return [
					{
						batchCount: 2,
						dataset: 'transactions',
						outputBytes: '20',
						recordCount: '10',
						schemaVersions: ['transactions-v1']
					}
				];
			}
			return [
				{
					batchCount: 2,
					firstAvailableLedger: '3',
					firstLedger: '3',
					lastLedger: '1026',
					ledgerCount: '192',
					nextLedger: '131',
					sourceCount: 1,
					updatedAt: new Date('2026-08-27T20:00:00.000Z')
				}
			];
		});

		await request(app)
			.get('/v1/history-data/catalog')
			.expect(200)
			.expect((response) => {
				expect(response.body.galexie.compatible).toBe(false);
				expect(response.body.coverage).toMatchObject({
					contiguousFirstLedger: '3',
					contiguousLastLedger: '130',
					contiguousLedgerCount: '128',
					supplementalLedgerCount: '64'
				});
				expect(response.body.historyOrigin).toEqual({
					explanation: expect.stringContaining(
						'Ledger 2 is the first LedgerCloseMeta'
					),
					firstLedgerCloseMeta: {
						hash: 'fe0f6bea5f341344fdb5bc6fc4ad719dd63071d9203e9a1e7f17c68ea1ecebde',
						previousLedgerHash:
							'39c2a3cd4141b2853e70d84601faa44744660334b48f3228e0309342e3f4eb48',
						sequence: '2',
						transactionCount: 0
					},
					genesis: {
						hash: '39c2a3cd4141b2853e70d84601faa44744660334b48f3228e0309342e3f4eb48',
						ledgerCloseMetaAvailable: false,
						sequence: '1'
					}
				});
			});
	});

	it('lists immutable batches with exact download paths', async () => {
		dataSource.query.mockImplementation(async (sql: string) => sql.includes('to_regclass') ? [{ available: false }] : [
			{
				batchId: '00000000-0000-4000-8000-000000000001',
				byteCount: '4',
				dataset: 'transactions',
				endLedger: '1026',
				ledgerCount: 1024,
				mediaType: 'application/vnd.apache.parquet',
				processedAt: new Date('2026-08-27T20:00:00.000Z'),
				recordCount: '10',
				representation: 'typed-projection',
				schemaVersion: 'transactions-v1',
				sha256: Buffer.alloc(32, 1),
				startLedger: '3'
			}
		]);

		await request(app)
			.get('/v1/history-data/batches?dataset=transactions&limit=1')
			.expect(200)
			.expect((response) => {
				expect(response.body.batches).toHaveLength(1);
				expect(response.body.batches[0].outputs[0]).toMatchObject({
					dataset: 'transactions',
					downloadPath:
						'/v1/history-data/batches/00000000-0000-4000-8000-000000000001/transactions',
					sha256: '01'.repeat(32)
				});
			});
	});

	it('streams an exact immutable artifact with range support', async () => {
		const storageKey = 'network/ledger-close-meta/3-1026/transactions.parquet';
		await mkdir(join(storageRoot, 'network/ledger-close-meta/3-1026'), {
			recursive: true
		});
		await writeFile(join(storageRoot, storageKey), Buffer.from('data'));
		dataSource.query.mockImplementation(async (sql: string) => sql.includes('to_regclass') ? [{ available: false }] : [
			{
				byteCount: '4',
				mediaType: 'application/vnd.apache.parquet',
				sha256: Buffer.alloc(32, 2),
				storageKey
			}
		]);

		await request(app)
			.get(
				'/v1/history-data/batches/00000000-0000-4000-8000-000000000001/transactions'
			)
			.set('Range', 'bytes=1-2')
			.expect(206)
			.expect('Content-Range', 'bytes 1-2/4')
			.expect('RateLimit-Limit', '120')
			.expect('X-Content-SHA256', '02'.repeat(32));
	});


	const retirementRow = {
		batchId: '00000000-0000-4000-8000-000000000001', networkIdSha256: '',
		startLedger: 3, endLedger: 1026, manifestSha256: '03'.repeat(32), canonicalSha256: '04'.repeat(32),
		dataset: 'transactions', outputSha256: '02'.repeat(32), byteCount: '4', recordCount: '10',
		storageKey: 'network/ledger-close-meta/3-1026/transactions.parquet',
		removed: false, namespaceRemovedColumn: false, namespaceIntentColumn: false,
		namespaceRemoved: false, namespaceIntentSha256: null,
		evidenceSha256: '05'.repeat(32), transformRevision: '06'.repeat(20)
	};
	it('returns Gone before filesystem access for explicitly retired exports', async () => {
		const { createHash } = await import('node:crypto');
		const row = { ...retirementRow, networkIdSha256: createHash('sha256')
			.update('Public Global Stellar Network ; September 2015').digest('hex') };
		dataSource.query.mockImplementation(async (sql: string) => {
			if (sql.includes('to_regclass')) return [{ available: true }];
			if (sql.includes('from full_history_lcm_derived_output_retirement')) return [row];
			return [{ byteCount: '4', mediaType: 'application/vnd.apache.parquet',
				sha256: Buffer.alloc(32, 2), storageKey: row.storageKey }];
		});
		await request(app).get('/v1/history-data/batches/' + row.batchId + '/transactions')
			.expect(410).expect('Cache-Control', 'no-store')
			.expect(response => expect(response.body.replacementPath).toMatch(/\/ledger-close-meta$/));
	});

	it('serves a qualified cold artifact at the original URL, without rebuilding for metadata or invalid ranges', async () => {
		const publicNetworkIdentity = 'Public Global Stellar Network ; September 2015';
		const sha = createHash('sha256').update('data').digest('hex');
		const row = { ...retirementRow, outputSha256: sha,
			networkIdSha256: createHash('sha256').update(publicNetworkIdentity).digest('hex') };
		const download = '/v1/history-data/batches/' + row.batchId + '/transactions';
		const cacheFile = join(storageRoot, 'verified');
		await writeFile(cacheFile, 'data');
		const acquire = jest.fn(async () => {
			const handle = await open(cacheFile, 'r');
			return { handle, release: () => handle.close() };
		});
		const cold = express().use('/v1/history-data', historyDataRouter({ dataSource,
			networkPassphrase: publicNetworkIdentity, storageRoot, coldReader: { supports: () => true, acquire } }));
		dataSource.query.mockImplementation(async (sql: string) => {
			if (sql.includes('to_regclass')) return [{ available: true }];
			if (sql.includes('from full_history_lcm_derived_output_retirement')) return [row];
			return [{ ...row, ledgerCount: 1024, processedAt: new Date(), mediaType: 'application/vnd.apache.parquet',
				representation: 'typed-projection', schemaVersion: 'transactions-v2', sha256: Buffer.from(sha, 'hex') }];
		});
		const tag = '"sha256-' + sha + '"';
		await request(cold).get('/v1/history-data/batches').expect(200).expect(r =>
			expect(r.body.batches[0].outputs[0]).toMatchObject({ availability: 'on-demand', downloadPath: download }));
		await request(cold).head(download).expect(200).expect('Content-Length', '4').expect('ETag', tag);
		await request(cold).get(download).set('If-None-Match', 'W/' + tag).set('Range', 'bytes=0-0').expect(304);
		await request(cold).get(download).set('Range', 'bytes=8-10').expect(416).expect('Content-Range', 'bytes */4');
		expect(acquire).not.toHaveBeenCalled();
		await request(cold).get(download).set('Range', 'bytes=1-2').expect(206).expect('Content-Range', 'bytes 1-2/4')
			.expect('Content-Length', '2').expect('ETag', tag).expect('X-Atlas-Artifact-Source', 'reconstructed')
			.expect(r => expect(r.text).toBe('at'));
		acquire.mockRejectedValueOnce(new Error('verified hash mismatch'));
		await request(cold).get(download).expect(503).expect('Cache-Control', 'no-store')
			.expect(r => expect(r.headers['x-content-sha256']).toBeUndefined());

		// Commit-then-unlink interleaves between our first catalog read and open.
		// Only the second exact retirement read, not the missing path, permits replay.
		let authorityReads = 0;
		dataSource.query.mockImplementation(async (sql: string) => {
			if (sql.includes('to_regclass')) return [{ available: true }];
			if (sql.includes('from full_history_lcm_derived_output_retirement')) return ++authorityReads === 1 ? [] : [row];
			return [{ byteCount: row.byteCount, mediaType: 'application/vnd.apache.parquet',
				sha256: Buffer.from(sha, 'hex'), storageKey: row.storageKey }];
		});
		await request(cold).get(download).set('Range', 'bytes=1-2').expect(206)
			.expect('X-Atlas-Artifact-Source', 'reconstructed').expect(r => expect(r.text).toBe('at'));
		expect(authorityReads).toBe(2);
		const callsBeforeUnexplainedMiss = acquire.mock.calls.length;
		authorityReads = 0;
		dataSource.query.mockImplementation(async (sql: string) => {
			if (sql.includes('to_regclass')) return [{ available: true }];
			if (sql.includes('from full_history_lcm_derived_output_retirement')) { authorityReads++; return []; }
			return [{ byteCount: row.byteCount, mediaType: 'application/vnd.apache.parquet',
				sha256: Buffer.from(sha, 'hex'), storageKey: row.storageKey }];
		});
		await request(cold).get(download).expect(503).expect('Cache-Control', 'no-store');
		expect(authorityReads).toBe(2);
		expect(acquire.mock.calls).toHaveLength(callsBeforeUnexplainedMiss);
	});

	it('rejects invalid dataset and batch identifiers without a query', async () => {
		expect(checkedHistoryStorageRoot(storageRoot)).toBe(storageRoot);
		expect(() => checkedHistoryStorageRoot(storageRoot + '/../escape')).toThrow();
		expect(() => historyColdReader({
			FULL_HISTORY_COLD_EXECUTABLE: '/tmp/untrusted-materializer',
			FULL_HISTORY_COLD_CACHE_ROOT: storageRoot + '-cache',
			FULL_HISTORY_COLD_CACHE_MAX_BYTES: '67108864',
			FULL_HISTORY_COLD_TRANSFORM_REVISION: '06'.repeat(20)
		}, 'Public Global Stellar Network ; September 2015', storageRoot)).toThrow();
		await request(app)
			.get('/v1/history-data/batches?dataset=unknown')
			.expect(400);
		await request(app)
			.get('/v1/history-data/batches/not-a-uuid/transactions')
			.expect(400);
		expect(dataSource.query).not.toHaveBeenCalled();
	});

	it('finishes an overlapping hot transfer across unlink while a new request reads the verified cold file', async () => {
		const body = Buffer.alloc(512 * 1024, 0x61);
		const sha = createHash('sha256').update(body).digest('hex');
		const publicNetworkIdentity = 'Public Global Stellar Network ; September 2015';
		const row = { ...retirementRow, outputSha256: sha, byteCount: String(body.length),
			networkIdSha256: createHash('sha256').update(publicNetworkIdentity).digest('hex') };
		const url = '/v1/history-data/batches/' + row.batchId + '/transactions';
		const hotPath = join(storageRoot, row.storageKey);
		await mkdir(join(storageRoot, 'network/ledger-close-meta/3-1026'), { recursive: true });
		await writeFile(hotPath, body);
		const coldPath = join(storageRoot, 'verified-cold'); await writeFile(coldPath, body);
		let retired = false;
		dataSource.query.mockImplementation(async (sql: string) => {
			if (sql.includes('to_regclass')) return [{ available: true }];
			if (sql.includes('from full_history_lcm_derived_output_retirement')) return retired ? [row] : [];
			return [{ byteCount: row.byteCount, mediaType: 'application/octet-stream',
				sha256: Buffer.from(sha, 'hex'), storageKey: row.storageKey }];
		});
		const acquire = jest.fn(async () => {
			const handle = await open(coldPath, 'r'); return { handle, release: () => handle.close() };
		});
		const overlap = express();
		let resumeHot: (() => void) | undefined;
		overlap.use((req, res, next) => {
			if (req.get('X-Test-Slow-Reader')) {
				const write = res.write.bind(res);
				res.write = ((chunk: Buffer) => {
					res.write = write;
					write(chunk.subarray(0, 1)); // flush headers and a real response byte
					resumeHot = () => { resumeHot = undefined; write(chunk.subarray(1)); res.emit('drain'); };
					return false; // same stream backpressure signal as a slow network socket
				}) as typeof res.write;
			}
			next();
		});
		overlap.use('/v1/history-data', historyDataRouter({ dataSource, networkPassphrase: publicNetworkIdentity,
			storageRoot, coldReader: { supports: () => true, acquire } }));
		let received!: () => void;
		const firstClientByte = new Promise<void>(r => { received = r; });
		const old = request(overlap).get(url).set('X-Test-Slow-Reader', 'yes').buffer(true).parse((incoming, done) => {
			const chunks: Buffer[] = [];
			incoming.on('data', (chunk: Buffer) => { chunks.push(chunk); received(); });
			incoming.on('error', done);
			incoming.on('end', () => done(null, Buffer.concat(chunks)));
		}).then(r => r);
		try {
			await Promise.race([firstClientByte, old.then(() => { throw new Error('Hot download completed too early'); })]);
			retired = true;
			await unlink(hotPath);
			await request(overlap).get(url).set('Range', 'bytes=10-11').expect(206)
				.expect('X-Atlas-Artifact-Source', 'reconstructed').expect(r => expect(r.body).toEqual(body.subarray(10, 12)));
		} finally { resumeHot?.(); }
		const hot = await old;
		expect(hot.status).toBe(200); expect(hot.headers['x-atlas-artifact-source']).toBeUndefined();
		expect(createHash('sha256').update(hot.body).digest('hex')).toBe(sha);
		expect(acquire).toHaveBeenCalledTimes(1);
	});
});
