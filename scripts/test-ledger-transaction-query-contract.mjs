import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

// Use the frontend's existing tsx dependency for ordinary checked-out TS imports.
// No source text extraction, transpile-and-evaluate VM, or parser implementation copy.
const require = createRequire(new URL('../apps/frontend-v4/package.json', import.meta.url));
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')));
const unregister = register({ tsconfig: false });
after(() => unregister());

const { registerHubbleDatasetRoutes } = await import('../apps/backend/src/status/infrastructure/http/HubbleWarehouseRouter.ts');
const { buildFilter } = await import('../apps/backend/src/status/infrastructure/http/HubbleWarehouseQuery.ts');
const { buildLedgerTransactionsPath } = await import('../apps/frontend-v4/src/api/explorer-ledger-transactions.ts');

function createResourceRequest() {
	const routes = new Map();
	let parsed;
	registerHubbleDatasetRoutes({
		get(path, handler) { routes.set(path, handler); },
		post() {}
	}, {
		async query(input) {
			parsed = input;
			return { rows: [], limit: input.limit, offset: input.offset, nextOffset: null };
		}
	});
	const handler = routes.get('/datasets/:dataset/records');
	assert.equal(typeof handler, 'function');
	return async (request) => {
		parsed = undefined;
		const response = {
			statusCode: null,
			body: null,
			setHeader() {},
			status(code) { this.statusCode = code; return this; },
			json(body) { this.body = body; return this; }
		};
		await handler(request, response);
		return { parsed, status: response.statusCode, body: response.body };
	};
}

test('ledger transaction URL is accepted by the registered backend GET handler and retains a typed ledger bound', async () => {
	const requestResource = createResourceRequest();
	for (const ledger of ['100', '64916610', '4294967295']) {
		const url = new URL(buildLedgerTransactionsPath(ledger, 25), 'https://api.example.invalid');
		assert.equal(url.pathname, '/v1/datasets/history_transactions/records');
		const request = { params: { dataset: 'history_transactions' }, query: Object.fromEntries(url.searchParams) };
		const accepted = await requestResource(request);
		assert.equal(accepted.status, 200);
		const parsed = accepted.parsed;
		assert.equal(parsed.dataset, 'history_transactions');
		assert.equal(parsed.limit, 25);
		assert.equal(parsed.offset, 25);
		assert.equal(parsed.filters.length, 1);
		assert.equal(parsed.filters[0].field, 'ledger_sequence');
		assert.equal(parsed.filters[0].operator, 'eq');
		assert.equal(parsed.filters[0].value, ledger);
		assert.equal(parsed.select.join(','), 'transaction_hash,ledger_sequence,account,fee_charged,operation_count,successful,closed_at');
		assert.equal(parsed.orderBy[0].field, 'id');
		assert.equal(parsed.orderBy[0].direction, 'asc');
		const parameters = [];
		assert.equal(buildFilter(new Map([['ledger_sequence', { name: 'ledger_sequence', type: 'UInt32' }]]), parsed.filters[0], 0, parameters), '`ledger_sequence` = {filter_0:UInt32}');
		assert.equal(parameters[0].value, ledger);
		assert.equal(parameters[0].type, 'UInt32');
		const rejected = await requestResource({ ...request, query: { ...request.query, _ledger_sequence: ledger } });
		assert.equal(rejected.status, 400);
		assert.equal(rejected.body.code, 'invalid_hubble_query');
		assert.match(rejected.body.error, /Invalid Hubble filter parameter: _ledger_sequence/);
		assert.equal(rejected.parsed, undefined, 'Invalid legacy keys must not reach the warehouse');
	}
	for (const offset of [0, 10000]) {
		assert.equal(new URL(buildLedgerTransactionsPath('100', offset), 'https://api.example.invalid').searchParams.get('offset'), String(offset));
	}
	for (const offset of [-1, 10001, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(() => buildLedgerTransactionsPath('100', offset), /Invalid ledger transaction selection/);
	}
});
