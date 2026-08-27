import express from 'express';
import request from 'supertest';
import { mock, type MockProxy } from 'jest-mock-extended';
import type { DataSource } from 'typeorm';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { historyDataRouter } from '../HistoryDataRouter.js';

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
				networkPassphrase: 'Public network',
				storageRoot
			})
		);
	});

	afterEach(async () => {
		await rm(storageRoot, { force: true, recursive: true });
	});

	it('reports continuous and supplemental catalog coverage', async () => {
		dataSource.query.mockImplementation(async (sql: string) => {
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
			});
	});

	it('lists immutable batches with exact download paths', async () => {
		dataSource.query.mockResolvedValue([
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
		dataSource.query.mockResolvedValue([
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
			.expect('X-Content-SHA256', '02'.repeat(32));
	});

	it('rejects invalid dataset and batch identifiers without a query', async () => {
		await request(app)
			.get('/v1/history-data/batches?dataset=unknown')
			.expect(400);
		await request(app)
			.get('/v1/history-data/batches/not-a-uuid/transactions')
			.expect(400);
		expect(dataSource.query).not.toHaveBeenCalled();
	});
});
