import express from 'express';
import { once } from 'node:events';
import { createServer, get } from 'node:http';
import { setTimeout } from 'node:timers/promises';
import request from 'supertest';
import { createExplorerClaimablePositionsHandler } from '../ExplorerClaimablePositions.js';
import {
	buildTestApp,
	canonicalSourceAccount as accountId
} from './BlockchainExplorerRouterTestFixture.js';

const other = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const route = '/v1/explorer/accounts/' + accountId + '/claimable-positions';
const firstId = '00000000' + 'b'.repeat(64);
const secondId = '00000000' + 'a'.repeat(64);
const ledger = 63386340;
const network = 'Test SDF Network ; September 2015';
const predicate = {
	and: [
		{ abs_before: '2020-12-30T23:03:56Z', abs_before_epoch: '1609369436' },
		{ not: { or: [{ rel_before: '300' }, { unconditional: true }] } }
	]
};

function row(id = firstId, modified = ledger - 1) {
	return {
		id,
		asset: 'USDC:' + other,
		amount: '922337203685.4775807',
		sponsor: accountId,
		last_modified_ledger: modified,
		last_modified_time: '2026-11-05T21:50:00Z',
		claimants: [
			{ destination: accountId, predicate },
			{ destination: other, predicate: { unconditional: true } }
		],
		paging_token: modified + '-' + id
	};
}

function page(
	records: unknown[],
	marker: string | null = String(ledger)
): Response {
	return Response.json(
		{
			_links: {
				next: {
					href: 'https://untrusted.invalid/claimable_balances?cursor=untrusted'
				}
			},
			_embedded: { records }
		},
		{ headers: marker === null ? {} : { 'Latest-Ledger': marker } }
	);
}

afterEach(() => jest.restoreAllMocks());

it('projects an exact claimant page with both roles and every claimant condition', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(page([row()]));
	const timeout = jest.spyOn(AbortSignal, 'timeout');
	const response = await request(buildTestApp())
		.get(route)
		.query({ role: 'claimant' })
		.expect(200)
		.expect('Cache-Control', 'no-store');
	expect(response.body).toEqual({
		source: 'horizon',
		accountId,
		networkPassphrase: network,
		role: 'claimant',
		latestLedger: String(ledger),
		snapshotStatus: 'ledger_bound',
		pageStatus: 'available',
		nextCursor: null,
		positions: [
			{
				id: firstId,
				assetId: 'USDC:' + other,
				amount: '922337203685.4775807',
				amountRaw: '9223372036854775807',
				sponsor: accountId,
				roles: ['claimant', 'sponsor'],
				lastModifiedLedger: String(ledger - 1),
				lastModifiedAt: '2026-11-05T21:50:00Z',
				claimants: [
					{
						destination: accountId,
						predicate: {
							type: 'and',
							predicates: [
								{
									type: 'before_absolute_time',
									epochSeconds: '1609369436',
									isoTime: '2020-12-30T23:03:56Z'
								},
								{
									type: 'not',
									predicate: {
										type: 'or',
										predicates: [
											{ type: 'before_relative_time', seconds: '300' },
											{ type: 'unconditional' }
										]
									}
								}
							]
						}
					},
					{ destination: other, predicate: { type: 'unconditional' } }
				]
			}
		]
	});
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(fetch.mock.calls[0]?.[0].toString()).toBe(
		'https://horizon.example/claimable_balances?claimant=' +
			accountId +
			'&limit=25&order=desc'
	);
	expect(fetch.mock.calls[0]?.[1]).toMatchObject({
		redirect: 'error',
		signal: expect.any(AbortSignal)
	});
	expect(timeout.mock.calls.map(([ms]) => ms)).toContain(65_000);
});

it('uses sponsor on the wire and exposes a sponsor-only role without evaluating the predicate', async () => {
	const fixture = {
		...row(),
		asset: 'native',
		amount: '0.0000001',
		claimants: [
			{
				destination: other,
				predicate: { abs_before_epoch: '9223372036854775807' }
			}
		]
	};
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(page([fixture]));
	const response = await request(buildTestApp())
		.get(route)
		.query({ role: 'sponsor', limit: 2 })
		.expect(200);
	expect(response.body.positions[0]).toMatchObject({
		assetId: 'native',
		amountRaw: '1',
		roles: ['sponsor'],
		claimants: [
			{
				destination: other,
				predicate: {
					type: 'before_absolute_time',
					epochSeconds: '9223372036854775807',
					isoTime: null
				}
			}
		]
	});
	expect(fetch.mock.calls[0]?.[0].toString()).toBe(
		'https://horizon.example/claimable_balances?sponsor=' +
			accountId +
			'&limit=2&order=desc'
	);
	expect(fetch).toHaveBeenCalledTimes(1);
});

it('deduplicates a full page, advances using the row token only, and carries each page ledger independently', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(page([row(), row()]))
		.mockResolvedValueOnce(page([row(secondId)], String(ledger + 1)));
	const app = buildTestApp();
	const first = await request(app)
		.get(route)
		.query({ role: 'claimant', limit: 2 })
		.expect(200);
	expect(first.body).toMatchObject({
		pageStatus: 'partial',
		positions: [{ id: firstId }],
		latestLedger: String(ledger)
	});
	const cursor: string = first.body.nextCursor;
	expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
	const second = await request(app)
		.get(route)
		.query({ role: 'claimant', limit: 2, cursor })
		.expect(200);
	expect(second.body).toMatchObject({
		pageStatus: 'available',
		positions: [{ id: secondId }],
		latestLedger: String(ledger + 1),
		nextCursor: null
	});
	expect(fetch).toHaveBeenCalledTimes(2);
	const target = new URL(fetch.mock.calls[1]![0].toString());
	expect(target.origin + target.pathname).toBe(
		'https://horizon.example/claimable_balances'
	);
	expect(target.searchParams.get('cursor')).toBe(row().paging_token);
});

it('rejects reusing a cursor across account, role or configured network before upstream work', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(page([row()]));
	const app = buildTestApp();
	const first = await request(app)
		.get(route)
		.query({ role: 'claimant', limit: 1 })
		.expect(200);
	const cursor: string = first.body.nextCursor;
	await request(app).get(route).query({ role: 'sponsor', cursor }).expect(400);
	await request(app)
		.get(route.replace(accountId, other))
		.query({ role: 'claimant', cursor })
		.expect(400);
	const secondNetwork = express();
	secondNetwork.get(
		route.replace(accountId, ':accountId'),
		createExplorerClaimablePositionsHandler({
			horizonUrl: 'https://horizon.example',
			networkPassphrase: 'Other network'
		})
	);
	await request(secondNetwork)
		.get(route)
		.query({ role: 'claimant', cursor })
		.expect(400);
	expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
	{},
	{ role: 'creator' },
	{ role: ['claimant', 'sponsor'] },
	{ role: 'claimant', limit: 26 },
	{ role: 'claimant', limit: '01' },
	{ role: 'claimant', limit: 0 },
	{ role: 'claimant', cursor: 'https://untrusted.invalid' },
	{ role: 'sponsor', url: 'https://untrusted.invalid' }
])(
	'rejects invalid scope or pagination without fetching (%j)',
	async (query) => {
		const fetch = jest.spyOn(globalThis, 'fetch');
		await request(buildTestApp()).get(route).query(query).expect(400);
		expect(fetch).not.toHaveBeenCalled();
	}
);

it('rejects a checksum-invalid account before querying Horizon', async () => {
	const fetch = jest.spyOn(globalThis, 'fetch');
	await request(buildTestApp())
		.get(route.replace(accountId, accountId.slice(0, -1) + 'A'))
		.query({ role: 'claimant' })
		.expect(400);
	expect(fetch).not.toHaveBeenCalled();
});

it.each([
	[
		'wrong claimant',
		[
			{
				...row(),
				claimants: [{ destination: other, predicate: { unconditional: true } }]
			}
		]
	],
	['wrong sponsor', [{ ...row(), sponsor: other }]],
	[
		'unknown predicate',
		[
			{
				...row(),
				claimants: [{ destination: accountId, predicate: { future_tag: true } }]
			}
		]
	],
	[
		'too deep',
		[
			{
				...row(),
				claimants: [
					{
						destination: accountId,
						predicate: {
							not: { not: { not: { not: { unconditional: true } } } }
						}
					}
				]
			}
		]
	],
	['conflicting repeated ID', [row(), { ...row(), amount: '1.0000000' }]],
	['amount float', [{ ...row(), amount: 1.1 }]],
	['mutation after snapshot', [row(firstId, ledger + 1)]],
	['paging token mismatch', [{ ...row(), paging_token: '1-' + secondId }]],
	['more records than requested', [row(), row(secondId), row()]]
] as const)(
	'returns unavailable for an invalid provider page (%s)',
	async (label, records) => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(page([...records]));
		await request(buildTestApp())
			.get(route)
			.query({
				role: label === 'wrong sponsor' ? 'sponsor' : 'claimant',
				limit: 2
			})
			.expect(502)
			.expect('Cache-Control', 'no-store')
			.expect({ error: 'claimable_positions_unavailable' });
		expect(fetch).toHaveBeenCalledTimes(1);
	}
);

it('distinguishes unbound empty evidence, unsupported and unavailable', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(page([], null))
		.mockResolvedValueOnce(new Response(null, { status: 501 }))
		.mockResolvedValueOnce(new Response(null, { status: 503 }));
	const app = buildTestApp();
	const empty = await request(app)
		.get(route)
		.query({ role: 'claimant' })
		.expect(200);
	expect(empty.body).toMatchObject({
		latestLedger: null,
		snapshotStatus: 'ledger_unavailable',
		positions: [],
		nextCursor: null
	});
	await request(app)
		.get(route)
		.query({ role: 'claimant' })
		.expect(501)
		.expect({ error: 'claimable_positions_unsupported' });
	await request(app)
		.get(route)
		.query({ role: 'claimant' })
		.expect(502)
		.expect({ error: 'claimable_positions_unavailable' });
	expect(fetch).toHaveBeenCalledTimes(3);
});

it('rejects the streamed response above one MiB without trusting Content-Length', async () => {
	const response = new Response(' '.repeat(1024 * 1024) + '{}');
	const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response);
	await request(buildTestApp())
		.get(route)
		.query({ role: 'sponsor' })
		.expect(502);
	expect(fetch).toHaveBeenCalledTimes(1);
});

it('aborts a pending provider read on client disconnect', async () => {
	let started!: () => void;
	let aborted!: () => void;
	const onStart = new Promise<void>((resolve) => {
		started = resolve;
	});
	const onAbort = new Promise<void>((resolve) => {
		aborted = resolve;
	});
	const fetch = jest.spyOn(globalThis, 'fetch').mockImplementationOnce(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					'abort',
					() => {
						aborted();
						reject(init.signal?.reason);
					},
					{ once: true }
				);
				started();
			})
	);
	const server = createServer(buildTestApp());
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Fixture did not bind');
	const pending = get({
		host: '127.0.0.1',
		port: address.port,
		path: route + '?role=claimant'
	});
	pending.on('error', () => undefined);
	const deadline = setTimeout(1500, undefined, { ref: false }).then(() => {
		throw new Error('Disconnect fixture timed out');
	});
	try {
		await Promise.race([onStart, deadline]);
		pending.destroy();
		await Promise.race([onAbort, deadline]);
		expect(fetch).toHaveBeenCalledTimes(1);
	} finally {
		pending.destroy();
		const closed = once(server, 'close');
		server.close();
		server.closeAllConnections();
		await closed;
	}
});
