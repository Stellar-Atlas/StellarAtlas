import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const backend = 'apps/backend/src/status/infrastructure/http/';

// Execute the committed parser and planner helpers, not a duplicate URL regex.
// Unrelated router registrations/imports are not needed for this pure contract check.
async function loadSource(path, exposed, globals = {}) {
	const source = await readFile(new URL(path, root), 'utf8');
	const parsed = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true);
	const isolated = ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed,
		parsed.statements.filter((statement) => !ts.isImportDeclaration(statement))));
	const compiled = ts.transpileModule(isolated, {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
	}).outputText;
	return runInNewContext(compiled + '\n;(' + exposed + ');', {
		exports: {}, URLSearchParams, ...globals
	}, { filename: path, timeout: 1000 });
}

test('ledger transaction URL is accepted by the backend resource parser and retains a typed ledger bound', async () => {
	class HubbleWarehouseInputError extends Error {}
	const parse = await loadSource(backend + 'HubbleWarehouseRouter.ts', 'parseResourceQuery', { HubbleWarehouseInputError });
	const buildFilter = await loadSource(backend + 'HubbleWarehouseQuery.ts', 'buildFilter', { HubbleWarehouseInputError });
	const buildPath = await loadSource('apps/frontend-v4/src/api/explorer-ledger-transactions.ts', 'buildLedgerTransactionsPath');
	for (const ledger of ['100', '64916610', '4294967295']) {
		const url = new URL(buildPath(ledger, 25), 'https://api.example.invalid');
		assert.equal(url.pathname, '/v1/datasets/history_transactions/records');
		const request = { params: { dataset: 'history_transactions' }, query: Object.fromEntries(url.searchParams) };
		const parsed = parse(request);
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
		assert.throws(() => parse({ ...request, query: { ...request.query, _ledger_sequence: ledger } }), /Invalid Hubble filter parameter: _ledger_sequence/);
	}
});
