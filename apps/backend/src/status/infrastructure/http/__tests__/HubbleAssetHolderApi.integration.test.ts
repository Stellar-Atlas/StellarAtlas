import express from 'express';
import request from 'supertest';
import { ClickHouseHubbleWarehouse } from '../HubbleWarehouseClient.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import {
	HubbleSemanticNotFoundError,
	semanticSend
} from '../HubbleSemanticRouteHelpers.js';
import { hubbleSemanticSchemas } from '../../../../core/infrastructure/http/HubbleSemanticOpenApiSchemas.js';
import { withHubbleOpenApiPaths } from '../../../../core/infrastructure/http/HubbleOpenApiDocument.js';
import { readOpenApiRecord } from '../../../../core/infrastructure/http/OpenApiDocumentProjection.js';

const account = 'G' + 'A'.repeat(55);
const issuer = 'G' + 'B'.repeat(55);
const balance = { account_id: account, balance: 42, ledger_sequence: 193 };

function fixture() {
	const requests: URL[] = [];
	let rows: unknown = [balance];
	const warehouse = new ClickHouseHubbleWarehouse({
		endpoint: 'http://127.0.0.1:18123',
		fetch: async (input) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			requests.push(url);
			const sql = url.searchParams.get('query') ?? '';
			let data: unknown;
			if (sql.includes('FROM system.columns'))
				data = [
					{ name: 'account_id', position: 1, table: 'accounts', type: 'String' }
				];
			else if (sql.includes('FROM system.parts'))
				data = [{ rows: '1', table: 'accounts' }];
			else if (sql.includes(' AS ranges,'))
				data = [
					{
						ranges: [
							[2, 65],
							[130, 193]
						],
						range_count: '2'
					}
				];
			else if (sql.includes('._ingestion_batches FINAL'))
				data = [
					{
						completed_batches: '2',
						failed_batches: '0',
						maximum_ledger: '193',
						minimum_ledger: '2',
						started_batches: '0',
						total_rows: '128'
					}
				];
			else if (sql.includes('.accounts') || sql.includes('.trustlines'))
				data = rows;
			else throw new Error('Unexpected query: ' + sql);
			return new Response(JSON.stringify({ data }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		}
	});
	const app = express();
	app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
	return {
		app,
		warehouse,
		requests,
		setRows(value: unknown) {
			rows = value;
		}
	};
}

describe('latest-ingested holder REST coverage', () => {
	it('preserves the existing non-holder not-found response after the helper extraction', async () => {
		const app = express();
		app.get('/ledger', async (_request, response) =>
			semanticSend(response, async () => {
				throw new HubbleSemanticNotFoundError(
					'Ledger was not found in the ingested range'
				);
			})
		);
		const response = await request(app).get('/ledger').expect(404);
		expect(response.body).toEqual({
			code: 'hubble_record_not_found',
			error: 'Ledger was not found in the ingested range'
		});
		expect(response.headers['cache-control']).toBe('no-store');
	});

	it('preserves balances and pagination while sharing cached coverage on lists, details and empty results', async () => {
		const f = fixture(),
			catalog = await f.warehouse.catalog();
		expect(f.requests).toHaveLength(4);
		const expected = {
			coverage: catalog.coverage,
			watermark: {
				mode: 'latest-ingested-observations',
				catalogGeneratedAt: catalog.generatedAt,
				catalogMaximumLedger: '193',
				snapshotPinned: false
			}
		};
		f.setRows([balance, { ...balance, account_id: issuer }]);
		const list = await request(f.app)
			.get('/v1/analytics/assets/native/holders?limit=1')
			.expect(200);
		expect(list.body).toMatchObject({
			...expected,
			asset: 'native',
			holders: [balance],
			nextCursor: account,
			limit: 1
		});
		expect(list.body.coverage.gapCount).toBe(1);
		expect(list.body.coverage.contiguousLastLedger).toBe('65');
		f.setRows([balance]);
		const detail = await request(f.app)
			.get('/v1/analytics/assets/native/holders/' + account)
			.expect(200);
		expect(detail.body).toEqual({
			...expected,
			asset: 'native',
			holder: balance
		});
		f.setRows([]);
		const empty = await request(f.app)
			.get('/v1/analytics/assets/native/holders/' + account)
			.expect(404);
		expect(empty.body).toMatchObject({
			...expected,
			asset: 'native',
			code: 'hubble_record_not_found'
		});
		expect(empty.body.error).toContain(
			'No positive balance in the latest ingested state'
		);
		expect(empty.body.error).toContain(
			'does not establish absence on the current chain'
		);
		expect(empty.body).not.toHaveProperty('holder');
		expect(f.requests).toHaveLength(7);
		expect(
			f.requests
				.slice(4)
				.every((url) => url.searchParams.get('query')?.includes('.accounts'))
		).toBe(true);
	});

	it('single-flights cold catalog reads across native and issued holder calls', async () => {
		const f = fixture();
		const pages = await Promise.all([
			f.warehouse.assetHolders({ asset: { type: 'native' }, limit: 1 }),
			f.warehouse.assetHolders({
				asset: { type: 'issued', code: 'USD', issuer },
				limit: 1
			})
		]);
		expect(f.requests).toHaveLength(6);
		expect(
			f.requests.filter((url) =>
				url.searchParams.get('query')?.includes('FROM system.columns')
			)
		).toHaveLength(1);
		expect(pages[1]).toMatchObject({
			asset: 'USD:' + issuer,
			coverage: pages[0]!.coverage,
			watermark: pages[0]!.watermark
		});
	});

	it('does not turn a malformed warehouse result into a no-balance404', async () => {
		const f = fixture();
		await f.warehouse.catalog();
		f.setRows(undefined);
		const log = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);
		try {
			const response = await request(f.app)
				.get('/v1/analytics/assets/native/holders/' + account)
				.expect(503);
			expect(response.body.code).toBe('hubble_warehouse_unavailable');
			expect(response.body).not.toHaveProperty('holder');
			expect(response.body).not.toHaveProperty('coverage');
		} finally {
			log.mockRestore();
		}
	});

	it('rejects unsupported historical filters before any warehouse access', async () => {
		const f = fixture();
		await request(f.app)
			.get('/v1/analytics/assets/native/holders?as_of_ledger=65')
			.expect(400);
		await request(f.app)
			.get(
				'/v1/analytics/assets/native/holders/' + account + '?ledger_sequence=65'
			)
			.expect(400);
		expect(f.requests).toHaveLength(0);
	});

	it('documents the same evidence on success and not-found responses without a current-state promise', () => {
		for (const name of [
			'HubbleHolderPage',
			'HubbleHolderDetail',
			'HubbleHolderNotFound'
		]) {
			const schema = hubbleSemanticSchemas[name]!;
			expect(schema.required).toEqual(
				expect.arrayContaining(['coverage', 'watermark'])
			);
			expect(schema.properties).toMatchObject({
				coverage: { $ref: '#/components/schemas/HubbleLedgerCoverage' },
				watermark: {
					properties: {
						mode: { enum: ['latest-ingested-observations'] },
						snapshotPinned: { enum: [false] }
					}
				}
			});
		}
		const doc = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
		const paths = readOpenApiRecord(doc.paths)!;
		for (const path of [
			'/v1/analytics/assets/{asset}/holders',
			'/v1/analytics/assets/{asset}/holders/{account}'
		]) {
			const get = readOpenApiRecord(readOpenApiRecord(paths[path])!.get)!;
			expect(get.summary).not.toContain('current');
		}
	});
});
