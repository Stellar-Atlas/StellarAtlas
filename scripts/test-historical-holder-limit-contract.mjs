import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Existing tsx dependency, ordinary fixed source imports, and no listener or engine.
const require = createRequire(new URL('../apps/frontend-v4/package.json', import.meta.url));
const { register } = await import(pathToFileURL(require.resolve('tsx/esm/api')));
const unregister = register({ tsconfig: false });
after(() => unregister());
const backendRequire = createRequire(new URL('../apps/backend/package.json', import.meta.url));
const express = backendRequire('express');
const { buildSchema, graphql } = backendRequire('graphql');
const { queryHubbleAssetHolders } = await import('../apps/backend/src/status/infrastructure/http/HubbleAssetHolderQuery.ts');
const { queryHubbleAccountBalances } = await import('../apps/backend/src/status/infrastructure/http/HubbleAccountBalanceQuery.ts');
const { registerHubbleSemanticRoutes } = await import('../apps/backend/src/status/infrastructure/http/HubbleSemanticRoutes.ts');
const { hubbleAssetHolderSchema, hubbleAssetHolderResolvers, configureHubbleAssetHolderScalar } = await import('../apps/backend/src/status/infrastructure/http/HubbleAssetHolderGraphql.ts');
const { summarizeHubbleLedgerCoverage } = await import('../apps/backend/src/status/infrastructure/http/HubbleLedgerCoverage.ts');
const { parseBalanceObservationPage } = await import('../apps/frontend-v4/src/api/explorer-balance-observations.ts');
const { StrKey } = backendRequire('@stellar/stellar-sdk');
const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const asset = 'USD:' + issuer;
const catalog = {
	coverage: summarizeHubbleLedgerCoverage([{ start_ledger: 2, end_ledger: 100 }]),
	generatedAt: '2026-09-07T00:00:00.000Z'
};

function restResponse() {
	const response = Object.create(express.response);
	const headers = new Map();
	response.app = express();
	response.statusCode = 200;
	response.getHeader = (name) => headers.get(name.toLowerCase());
	response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
	response.send = (text) => { response.text = text; return response; };
	return response;
}

test('native historical holders keep an absent trustline limit as null at the consumer', async () => {
	const page = await queryHubbleAssetHolders({ database: 'synthetic_holders', maximumRows: 200,
		async execute(sql) {
			assert.match(sql, /FROM `synthetic_holders`\.accounts/);
			assert.doesNotMatch(sql, /_latest_trust_line_limit/);
			return { data: [{ account_id: account, balance: 1, buying_liabilities: 0,
				selling_liabilities: 0, ledger_sequence: 50, last_modified_ledger: 49 }] };
		}
	}, { asset: { type: 'native' }, asOfLedger: 50, limit: 25 }, catalog);
	assert.equal(page.holders[0].trust_line_limit, undefined);
	assert.equal(parseBalanceObservationPage('holders', 'native', page).rows[0].trustLineLimit, null);
	assert.equal(page.watermark.snapshotPinned, false);
});

test('the current holder index keeps its existing exact string projection', async () => {
	let calls = 0;
	const page = await queryHubbleAssetHolders({ database: 'synthetic_holders', maximumRows: 200,
		async execute(sql) {
			calls++;
			if (sql.includes('._asset_holder_index_assets')) return { data: [{ ready: 1 }] };
			assert.match(sql, /toString\(tupleElement\(state,7\)\) AS trust_line_limit/);
			assert.doesNotMatch(sql, /toString\(_latest_trust_line_limit\)/);
			return { data: [{ account_id: account, balance: 1, trust_line_limit: '9223372036854775807' }] };
		}
	}, { asset: { type: 'issued', code: 'USD', issuer }, limit: 25 }, catalog);
	assert.equal(calls, 2);
	assert.equal(page.holders[0].trust_line_limit, '9223372036854775807');
	assert.equal(page.watermark.balancePrecision, 'source-float64');
});

test('wallet native null and issued raw limits remain unchanged', async () => {
	const page = await queryHubbleAccountBalances({ database: 'synthetic_holders', maximumRows: 200,
		async execute(sql) {
			assert.match(sql, /toNullable\(toString\(tupleElement\(observed,5\)\)\) AS trust_line_limit_raw/);
			assert.match(sql, /ORDER BY asset_kind,asset_code,asset_issuer/);
			return { data: [
				{ asset_type: 'native', asset_code: '', asset_issuer: '', balance: 1,
					buying_liabilities: 0, selling_liabilities: 0, trust_line_limit_raw: null,
					flags: 0, last_modified_ledger: 49, ledger_sequence: 50 },
				{ asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: issuer,
					balance: 1e-7, buying_liabilities: 0, selling_liabilities: 0,
					trust_line_limit_raw: '9223372036854775807', flags: 1,
					last_modified_ledger: 49, ledger_sequence: 50 }
			] };
		}
	}, { account, limit: 25 }, catalog);
	assert.equal(page.balances[0].trustLineLimitRaw, null);
	assert.equal(page.balances[1].trustLineLimitRaw, '9223372036854775807');
	assert.equal(page.balances[1].balanceRaw, null);
	assert.equal(page.balances[1].amountPrecision, 'float64-observation');
	assert.equal(parseBalanceObservationPage('balances', account, page).rows[1].trustLineLimit, '9223372036854775807');
});

for (const raw of ['9223372036854775807', '9007199254740993']) {
	test('historical holder limit stays exact through query, REST, GraphQL and consumer: ' + raw, async () => {
		const requests = [];
		const row = {
			account_id: account, asset_code: 'USD', asset_issuer: issuer,
			asset_type: 'credit_alphanum4', balance: 0.0000001,
			buying_liabilities: 0, selling_liabilities: 1.25,
			trust_line_limit: raw, flags: 1, deleted: false,
			ledger_sequence: 50, last_modified_ledger: 49
		};
		const executor = {
			database: 'synthetic_holders', maximumRows: 200,
			async execute(sql, parameters) {
				requests.push({ sql, parameters });
				assert.match(sql, /toString\(_latest_trust_line_limit\) AS trust_line_limit/);
				assert.match(sql, /ledger_sequence <= \{as_of_ledger:UInt32\}/);
				assert.match(sql, /ORDER BY _latest_balance DESC, account_id ASC/);
				assert.match(sql, /WHERE 1 AND _latest_deleted = false AND _latest_balance > 0/);
				assert.deepEqual(parameters.find((p) => p.name === 'as_of_ledger'), { name: 'as_of_ledger', type: 'UInt32', value: '50' });
				assert.deepEqual(parameters.find((p) => p.name === 'row_limit'), { name: 'row_limit', type: 'UInt32', value: '26' });
				// The engine boundary is separately tested with finite inline rows.
				return JSON.parse(JSON.stringify({ data: [row] }));
			}
		};
		const warehouse = { assetHolders: (input) => queryHubbleAssetHolders(executor, input, catalog) };
		const routes = new Map();
		registerHubbleSemanticRoutes({ get(path, handler) { routes.set(path, handler); } }, warehouse);
		const handler = routes.get('/assets/:asset/holders');
		assert.equal(typeof handler, 'function');
		const response = restResponse();
		await handler({ params: { asset }, query: { as_of_ledger: '50', limit: '25', sort: 'balance', order: 'desc' } }, response);
		assert.equal(response.statusCode, 200);
		assert.equal(response.getHeader('cache-control'), 'no-store');
		const rest = JSON.parse(response.text);
		assert.equal(rest.holders[0].trust_line_limit, raw);
		assert.equal(typeof rest.holders[0].trust_line_limit, 'string');
		assert.equal(rest.holders[0].balance, row.balance);
		assert.equal(rest.nextCursor, null);
		assert.equal(rest.watermark.snapshotPinned, false);
		assert.equal(rest.watermark.balancePrecision, 'source-float64');
		assert.equal(parseBalanceObservationPage('holders', asset, rest).rows[0].trustLineLimit, raw);
		const schema = buildSchema(`type Query { unused: Boolean }
			type HubbleLedgerCoverage { maximumLedger: String }
		` + hubbleAssetHolderSchema);
		configureHubbleAssetHolderScalar(schema);
		const result = await graphql({ schema,
			source: 'query($asset:String!){hubbleAssetHolders(asset:$asset,input:{asOfLedger:50,limit:25,sort:"balance",order:"desc"}){holders{trustLineLimit balance amountPrecision} watermark{snapshotPinned balancePrecision}}}',
			variableValues: { asset }, rootValue: hubbleAssetHolderResolvers(warehouse, (error) => error)
		});
		assert.equal(result.errors, undefined);
		assert.equal(result.data.hubbleAssetHolders.holders[0].trustLineLimit, raw);
		assert.equal(result.data.hubbleAssetHolders.holders[0].balance, row.balance);
		assert.equal(result.data.hubbleAssetHolders.holders[0].amountPrecision, 'float64-observation');
		assert.equal(result.data.hubbleAssetHolders.watermark.snapshotPinned, false);
		assert.equal(requests.length, 2, 'Only the two explicitly exercised service calls');
		assert.notEqual(String(Number(raw)), raw, 'Unsafe numeric coercion is a real negative control');
	});
}
