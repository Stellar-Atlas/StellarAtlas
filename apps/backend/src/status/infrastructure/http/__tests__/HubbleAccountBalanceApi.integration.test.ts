import express from 'express';
import { once } from 'node:events';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import request from 'supertest';
import { StrKey } from '@stellar/stellar-sdk';
import {
	ClickHouseHubbleWarehouse,
	hubbleWarehouseFromEnvironment
} from '../HubbleWarehouseClient.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import { encodeBalanceCursor } from '../HubbleAccountBalanceCursor.js';
import { withHubbleRequestCancellation } from '../HubbleRequestCancellation.js';
import { withHubbleOpenApiPaths } from '../../../../core/infrastructure/http/HubbleOpenApiDocument.js';
import { readOpenApiRecord } from '../../../../core/infrastructure/http/OpenApiDocumentProjection.js';

const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const native = {
	asset_kind: 0,
	asset_type: 'native',
	asset_code: '',
	asset_issuer: '',
	balance: 0,
	buying_liabilities: 1.25,
	selling_liabilities: 2.5,
	last_modified_ledger: '12',
	ledger_sequence: '65',
	flags: '0',
	trust_line_limit_raw: null
};
const issued = {
	...native,
	asset_kind: 1,
	asset_type: 'credit_alphanum4',
	asset_code: 'USD',
	asset_issuer: issuer,
	balance: 123.456789,
	trust_line_limit_raw: '9223372036854775807'
};
function fixture(
	hooks: {
		beforeQuery?: (
			sql: string,
			signal: AbortSignal | null | undefined
		) => Promise<void>;
		onRequest?: (onClose: (notify: () => void) => void) => void;
	} = {}
) {
	const requests: URL[] = [];
	let rows: unknown = [native, issued];
	const warehouse = new ClickHouseHubbleWarehouse({
		endpoint: 'http://127.0.0.1:18123',
		fetch: async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			requests.push(url);
			const sql = url.searchParams.get('query') ?? '';
			await hooks.beforeQuery?.(sql, init?.signal);
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
			else if (sql.includes('.accounts') && sql.includes('.trustlines'))
				data = rows;
			else throw new Error('Unexpected query');
			return new Response(JSON.stringify({ data }), { status: 200 });
		}
	});
	const app = express();
	app.use((_request, response, next) => {
		hooks.onRequest?.((notify) => {
			response.once('close', notify);
		});
		next();
	});
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

function gate() {
	let release!: () => void;
	const ready = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { ready, release };
}

const isWalletSelect = (sql: string) =>
	sql.includes('.accounts') && sql.includes('.trustlines');

describe('account balance request lifetime', () => {
	it('keeps slow work after the last caller disconnects, joins concurrent retries and reuses the result', async () => {
		const started = gate(),
			finish = gate(),
			abandonedClosed = gate(),
			retriesArrived = gate();
		let opened = 0;
		let querySignal: AbortSignal | null | undefined;
		const f = fixture({
			async beforeQuery(sql, signal) {
				if (!isWalletSelect(sql)) return;
				querySignal = signal;
				started.release();
				await finish.ready;
			},
			onRequest(onClose) {
				if (++opened === 1) onClose(abandonedClosed.release);
				if (opened === 3) retriesArrived.release();
			}
		});
		const server = f.app.listen(0, '127.0.0.1');
		await once(server, 'listening');
		const address = server.address();
		if (address === null || typeof address === 'string')
			throw new Error('No test address');
		const url = `http://127.0.0.1:${address.port}/v1/analytics/accounts/${account}/balances?limit=1`;
		const controller = new AbortController();
		const original = fetch(url, { signal: controller.signal }).catch(
			(error: unknown) => error
		);
		try {
			await started.ready;
			controller.abort();
			await abandonedClosed.ready;
			expect(await original).toMatchObject({ name: 'AbortError' });
			expect(querySignal?.aborted).toBe(false);
			const retryA = fetch(url),
				retryB = fetch(url);
			await retriesArrived.ready;
			expect(
				f.requests.filter((item) =>
					isWalletSelect(item.searchParams.get('query') ?? '')
				)
			).toHaveLength(1);
			finish.release();
			const bodies = await Promise.all(
				[retryA, retryB].map(async (pending) => {
					const response = await pending;
					expect(response.status).toBe(200);
					expect(response.headers.get('cache-control')).toBe('no-store');
					return response.json();
				})
			);
			expect(bodies[0]).toEqual(bodies[1]);
			expect(bodies[0]).toMatchObject({
				account,
				limit: 1,
				nextCursor: expect.any(String)
			});
			const replay = await fetch(url);
			expect(await replay.json()).toEqual(bodies[0]);
			expect(
				f.requests.filter((item) =>
					isWalletSelect(item.searchParams.get('query') ?? '')
				)
			).toHaveLength(1);
		} finally {
			finish.release();
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it('uses a stable engine query identity across warehouse instances, distinct for account, cursor and limit', async () => {
		const a = fixture(),
			b = fixture();
		const first = await a.warehouse.accountBalances({ account, limit: 1 });
		await b.warehouse.accountBalances({ account, limit: 1 });
		await a.warehouse.accountBalances({
			account,
			limit: 1,
			after: first.nextCursor!
		});
		const cursorJson: unknown = JSON.parse(
			Buffer.from(first.nextCursor!, 'base64url').toString('utf8')
		);
		await a.warehouse.accountBalances({
			account,
			limit: 1,
			after: Buffer.from(JSON.stringify(cursorJson, null, 1)).toString(
				'base64url'
			)
		});
		await a.warehouse.accountBalances({ account, limit: 2 });
		await a.warehouse.accountBalances({ account: issuer, limit: 1 });
		const wallet = (f: ReturnType<typeof fixture>) =>
			f.requests.filter((item) =>
				isWalletSelect(item.searchParams.get('query') ?? '')
			);
		const ids = wallet(a).map((item) => item.searchParams.get('query_id'));
		expect(ids).toHaveLength(4);
		expect(new Set(ids).size).toBe(4);
		expect(ids[0]).toMatch(/^atlas-account-balances-v1-[a-f0-9]{64}$/);
		expect(wallet(b)[0]!.searchParams.get('query_id')).toBe(ids[0]);
		expect(
			wallet(a).every(
				(item) =>
					!item.searchParams.has('replace_running_query') &&
					!item.searchParams.has('max_execution_time')
			)
		).toBe(true);
	});

	it('keeps catalog loading independent of a canceled requester that started it', async () => {
		const started = gate(),
			finish = gate();
		let catalogSignal: AbortSignal | null | undefined;
		const f = fixture({
			async beforeQuery(sql, signal) {
				if (!sql.includes('FROM system.columns')) return;
				catalogSignal = signal;
				started.release();
				await finish.ready;
			}
		});
		const incoming = new IncomingMessage(new Socket());
		const outgoing = new ServerResponse(incoming);
		const catalog = withHubbleRequestCancellation(incoming, outgoing, () =>
			f.warehouse.catalog()
		);
		await started.ready;
		outgoing.emit('close');
		expect(catalogSignal?.aborted).toBe(false);
		const wallet = f.warehouse.accountBalances({ account, limit: 1 });
		finish.release();
		const [loaded, page] = await Promise.all([catalog, wallet]);
		expect(page.coverage).toBe(loaded.coverage);
		expect(
			f.requests.filter((item) =>
				item.searchParams.get('query')?.includes('FROM system.columns')
			)
		).toHaveLength(1);
	});
});
describe('account latest-ingested balances REST', () => {
	it('returns native zero and issued observations, exact limit strings and shared coverage in keyset pages', async () => {
		const f = fixture(),
			catalog = await f.warehouse.catalog();
		expect(f.requests).toHaveLength(4);
		const first = await request(f.app)
			.get('/v1/analytics/accounts/' + account + '/balances?limit=1')
			.expect(200);
		expect(first.body).toMatchObject({
			account,
			balanceScope: 'native-and-issued',
			limit: 1,
			balances: [
				{
					asset: 'native',
					assetCode: null,
					balance: 0,
					balanceRaw: null,
					amountPrecision: 'float64-observation',
					observedLedger: 65
				}
			],
			coverage: catalog.coverage,
			watermark: {
				mode: 'latest-ingested-observations',
				snapshotPinned: false,
				catalogGeneratedAt: catalog.generatedAt
			}
		});
		expect(first.body.nextCursor).toEqual(expect.any(String));
		f.setRows([issued]);
		const second = await request(f.app)
			.get('/v1/analytics/accounts/' + account + '/balances')
			.query({ limit: 1, after: first.body.nextCursor })
			.expect(200);
		expect(second.body.balances).toEqual([
			expect.objectContaining({
				asset: 'USD:' + issuer,
				balance: 123.456789,
				balanceRaw: null,
				trustLineLimitRaw: '9223372036854775807'
			})
		]);
		expect(second.body.nextCursor).toBeNull();
		expect(f.requests).toHaveLength(6);
		expect(f.requests[5]!.searchParams.get('param_include_native')).toBe('0');
		expect(f.requests[5]!.searchParams.get('query')).not.toMatch(
			/OFFSET|balance > 0/i
		);
	});
	it('returns an empty covered200, not a false account/current-chain404', async () => {
		const f = fixture();
		f.setRows([]);
		const response = await request(f.app)
			.get('/v1/analytics/accounts/' + account + '/balances')
			.expect(200);
		expect(response.body).toMatchObject({
			balances: [],
			nextCursor: null,
			coverage: { gapCount: 1 },
			watermark: { snapshotPinned: false }
		});
	});
	it.each([
		'?as_of_ledger=65',
		'?ledger_sequence=65',
		'?offset=1',
		'?limit=0',
		'?limit=201',
		'?limit=1&limit=2',
		'?after=garbage'
	])(
		'rejects unsupported or malformed input %s before any warehouse access',
		async (query) => {
			const f = fixture();
			await request(f.app)
				.get('/v1/analytics/accounts/' + account + '/balances' + query)
				.expect(400);
			expect(f.requests).toHaveLength(0);
		}
	);
	it('rejects wrong checksums and cursors belonging to another account', async () => {
		const f = fixture(),
			cursor = encodeBalanceCursor(issuer, { kind: 0, code: '', issuer: '' });
		await request(f.app)
			.get('/v1/analytics/accounts/' + 'G' + 'A'.repeat(55) + '/balances')
			.expect(400);
		await request(f.app)
			.get('/v1/analytics/accounts/' + account + '/balances')
			.query({ after: cursor })
			.expect(400);
		expect(f.requests).toHaveLength(0);
	});
	it.each([
		undefined,
		[{ ...issued, balance: '123' }],
		[{ ...issued, asset_issuer: 'invalid' }],
		[{ ...native, ledger_sequence: '9007199254740993' }]
	])(
		'does not disguise malformed warehouse data as empty balances',
		async (rows) => {
			const f = fixture();
			f.setRows(rows);
			const log = jest
				.spyOn(console, 'error')
				.mockImplementation(() => undefined);
			try {
				const response = await request(f.app)
					.get('/v1/analytics/accounts/' + account + '/balances')
					.expect(503);
				expect(response.body.code).toBe('hubble_warehouse_unavailable');
			} finally {
				log.mockRestore();
			}
		}
	);
	it('implements the unavailable warehouse contract', async () => {
		await expect(
			hubbleWarehouseFromEnvironment({}).accountBalances({ account })
		).rejects.toThrow('not configured');
	});
	it('documents exact supported parameters, partial coverage and observed precision', () => {
		const doc = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
		const path = readOpenApiRecord(
			readOpenApiRecord(doc.paths)!['/v1/analytics/accounts/{account}/balances']
		)!;
		const get = readOpenApiRecord(path.get)!;
		expect(get.operationId).toBe('listAnalyticsAccountBalances');
		expect(get.parameters).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ name: 'account' }),
				expect.objectContaining({ name: 'after' }),
				expect.objectContaining({ name: 'limit' })
			])
		);
		expect(get.responses).not.toHaveProperty('404');
		const schemas = readOpenApiRecord(
			readOpenApiRecord(doc.components)!.schemas
		)!;
		expect(schemas.HubbleAccountBalance).toMatchObject({
			properties: {
				amountPrecision: { enum: ['float64-observation'] },
				balanceRaw: { enum: [null] }
			}
		});
	});
});
