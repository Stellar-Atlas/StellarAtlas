import { jest, test, expect } from '@jest/globals';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { graphql, printSchema, GraphQLSchema, GraphQLObjectType } from 'graphql';
import { account, issuer, asset, accountQuery, holderQuery, transactionHash, transactionQuery, designWarehouse } from './design-data.mjs';
import { rest } from './in-memory-rest.mjs';
import { normalizeTransactionInput } from '../../apps/backend/src/status/infrastructure/http/HubbleTransactionCursor.js';
import { HubbleWarehouseUnavailableError } from '../../apps/backend/src/status/infrastructure/http/HubbleWarehouseErrors.js';

// Capture the actual registered schema/root resolvers. Transport adaptation is
// intentionally excluded: no Express listener or HTTP socket is opened.
let registration;
jest.unstable_mockModule('graphql-http/lib/use/express', () => ({
  createHandler(options) { registration = options; return () => { throw new Error('HTTP transport excluded'); }; }
}), { virtual: true });
const { hubbleWarehouseGraphqlHandler } = await import('../../apps/backend/src/status/infrastructure/http/HubbleWarehouseGraphql.js');
const { withHubbleOpenApiPaths } = await import('../../apps/backend/src/core/infrastructure/http/HubbleOpenApiDocument.js');
const { withAssetResourceOpenApiPaths } = await import('../../apps/backend/src/core/infrastructure/http/AssetResourceOpenApi.js');
const folder = fileURLToPath(new URL('./fixtures/', import.meta.url));
const updating = process.env.UPDATE_SDK_FIXTURES === '1';
function pinned(name, value) {
  let text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n';
  if (name === 'openapi-selected.json') {
    const head = JSON.stringify({ openapi: value.openapi, paths: value.paths }, null, 2);
    text = head.slice(0, -2) + ',\n  "components": { "schemas": {\n' +
      Object.entries(value.components.schemas).map(([key, schema]) => '    ' + JSON.stringify(key) + ': ' + JSON.stringify(schema)).join(',\n') + '\n  } }\n}\n';
  }
  const file = folder + name;
  if (updating) { fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(file, text); }
  expect(fs.readFileSync(file, 'utf8')).toBe(text);
}
async function graph(warehouse, query, variables) {
  hubbleWarehouseGraphqlHandler(warehouse);
  return JSON.parse(JSON.stringify(await graphql({ schema: registration.schema, rootValue: registration.rootValue,
    source: query, variableValues: variables })));
}
async function pair(name, path, query, variables, warehouse = designWarehouse(), expectedStatus = 200) {
  const response = await rest(warehouse, path);
  expect(response.status).toBe(expectedStatus);
  const result = await graph(warehouse, query, variables);
  const value = {
    kind: 'synthetic-design-fixture',
    rest: { request: { method: 'GET', path }, response },
    graphql: { request: { method: 'POST', path: '/graphql', accept: 'application/json', body: { query, variables } },
      // HTTP200 for resolver errors is pinned by registered API tests, not an HTTP assertion in this socket-free test.
      expectedHttpStatus: 200, responseBody: result }
  };
  pinned(name + '.json', value);
  return { rest: response.body, graphql: result, warehouse };
}

test('pin selected OpenAPI projection and actual registered GraphQL schema', () => {
  const document = withAssetResourceOpenApiPaths(withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {}, components: { schemas: {} } }));
  const selected = ['/v1/analytics/accounts/{account}/balances', '/v1/assets/{asset}/holders', '/v1/analytics/transactions/{transactionHash}'];
  const paths = Object.fromEntries(selected.map(path => { expect(document.paths[path]).toBeDefined(); return [path, document.paths[path]]; }));
  const schemas = {}, pending = [paths];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (typeof value.$ref === 'string') {
      const name = value.$ref.replace('#/components/schemas/', '');
      if (!schemas[name]) { expect(document.components.schemas[name]).toBeDefined(); schemas[name] = document.components.schemas[name]; pending.push(schemas[name]); }
    }
    pending.push(...Object.values(value));
  }
  pinned('openapi-selected.json', { openapi: document.openapi, paths, components: { schemas } });
  hubbleWarehouseGraphqlHandler(designWarehouse());
  const query = registration.schema.getQueryType().toConfig();
  const selectedQuery = new GraphQLObjectType({ ...query, fields: Object.fromEntries(
    ['hubbleAccountBalances', 'hubbleAssetHolders', 'hubbleTransaction'].map(key => [key, query.fields[key]])
  ) });
  const selectedSchema = printSchema(new GraphQLSchema({ query: selectedQuery })) + '\n';
  pinned('schema.graphql', selectedSchema);
  pinned('schema-digests.json', { fullRegisteredSchemaSha256: createHash('sha256').update(printSchema(registration.schema) + '\n').digest('hex'),
    selectedSchemaSha256: createHash('sha256').update(selectedSchema).digest('hex') });
});

test('account first and terminal pages preserve exact limit strings and Float64 provenance', async () => {
  const first = await pair('account-first', `/v1/analytics/accounts/${account}/balances?limit=1`, accountQuery, { account, input: { limit: 1 } });
  expect(first.graphql.errors).toBeUndefined();
  expect(first.rest.nextCursor).toBeTruthy();
  expect(first.rest.balances[0]).toMatchObject({ balanceRaw: null, amountPrecision: 'float64-observation' });
  const after = first.rest.nextCursor;
  const terminal = await pair('account-terminal', `/v1/analytics/accounts/${account}/balances?limit=1&after=${encodeURIComponent(after)}`, accountQuery, { account, input: { limit: 1, after } });
  expect(terminal.rest.nextCursor).toBeNull();
  expect(terminal.graphql.data.hubbleAccountBalances.nextCursor).toBeNull();
  expect(terminal.rest.balances[0].trustLineLimitRaw).toBe('9223372036854775807');
  expect(typeof terminal.rest.balances[0].balance).toBe('number');
  expect(terminal.rest.watermark.snapshotPinned).toBe(false);
  expect(terminal.rest.coverage.gapCount).toBe(1);
});

test('holder first and terminal pages map snake-case source fields and preserve parsed numeric strings', async () => {
  const input = { limit: 1, sort: 'balance', order: 'desc' };
  const path = `/v1/assets/${encodeURIComponent(asset)}/holders?limit=1&sort=balance&order=desc`;
  const first = await pair('holder-first', path, holderQuery, { asset, input });
  expect(first.graphql.errors).toBeUndefined();
  expect(first.rest.nextCursor.startsWith('c.')).toBe(true);
  const after = first.rest.nextCursor;
  const terminal = await pair('holder-terminal', path + '&after=' + encodeURIComponent(after), holderQuery, { asset, input: { ...input, after } });
  expect(terminal.rest.nextCursor).toBeNull();
  expect(terminal.graphql.data.hubbleAssetHolders.nextCursor).toBeNull();
  expect(terminal.rest.holders[0].balance).toBe('0.10000000000000001');
  expect(terminal.graphql.data.hubbleAssetHolders.holders[0]).toMatchObject({ balance: '0.10000000000000001', amountPrecision: 'float64-observation' });
});

test('typed transaction relationship cursors stay separate through continuation and terminal pages', async () => {
  const path = `/v1/analytics/transactions/${transactionHash}?view=typed&ledger_sequence=26000000&limit=1`;
  const variables = { hash: transactionHash, ledger: 26000000, limit: 1 };
  const first = await pair('transaction-first', path, transactionQuery, variables);
  expect(first.graphql.errors).toBeUndefined();
  expect(BigInt(first.rest.transaction.id)).toBeGreaterThan(9007199254740992n);
  expect(first.rest.operations.items[0].amounts[0].raw).toBe('9007199254740993');
  expect(first.graphql.data.hubbleTransaction.transaction.id).toBe(first.rest.transaction.id);
  expect(first.graphql.data.hubbleTransaction.operations.items[0].amounts[0]).toMatchObject({
    raw: '9007199254740993', decimal: '900719925.4740993', scale: 7
  });
  expect(first.graphql.data.hubbleTransaction.events.items[0].dataJson).toContain('9007199254740993');
  const cursors = Object.fromEntries(['operations', 'effects', 'events'].map(key => [key + 'After', first.rest[key].nextCursor]));
  const continuedPath = path + ['operations', 'effects', 'events'].map(key => '&' + key + '_after=' + encodeURIComponent(cursors[key + 'After'])).join('');
  const second = await pair('transaction-continued', continuedPath, transactionQuery, { ...variables, ...cursors });
  expect(second.rest.operations.nextCursor).toBeNull();
  expect(second.rest.events.nextCursor).toBeNull();
  expect(second.rest.effects.nextCursor).toBeTruthy();
  const finalCursors = { ...cursors, effectsAfter: second.rest.effects.nextCursor };
  const finalPath = path + ['operations', 'effects', 'events'].map(key => '&' + key + '_after=' + encodeURIComponent(finalCursors[key + 'After'])).join('');
  const terminal = await pair('transaction-terminal', finalPath, transactionQuery, { ...variables, ...finalCursors });
  for (const key of ['operations', 'effects', 'events']) expect(terminal.rest[key].nextCursor).toBeNull();
  expect(terminal.graphql.errors).toBeUndefined();
});

test('invalid resolver input distinguishes REST HTTP400 from GraphQL errors in an HTTP200 envelope', async () => {
  const result = await pair('invalid-limit', `/v1/analytics/accounts/${account}/balances?limit=201`, accountQuery, { account, input: { limit: 201 } }, designWarehouse(), 400);
  expect(result.rest.code).toBe('invalid_hubble_query');
  expect(result.graphql.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  expect(result.graphql.data).toBeNull();
  expect(result.warehouse.calls).toHaveLength(0);
});

test('UInt32 REST observations expose the GraphQL signed-Int response limitation', async () => {
  const result = await pair('account-uint32-observation', `/v1/analytics/accounts/${account}/balances?limit=1`, accountQuery, { account, input: { limit: 1 } }, designWarehouse({ uint32: true }));
  expect(result.rest.balances[0].observedLedger).toBe(4294967295);
  expect(result.graphql.errors[0].message).toContain('Int cannot represent non 32-bit signed integer value');
});

test('REST holder UInt32 upper bound is valid but GraphQL variable coercion cannot represent it', async () => {
  const warehouse = designWarehouse({ uint32: true });
  const response = await rest(warehouse, `/v1/assets/${encodeURIComponent(asset)}/holders?limit=1&as_of_ledger=4294967295`);
  expect(response.status).toBe(200);
  expect(response.body.watermark.selectedLedger).toBe('4294967295');
  const variables = { asset, input: { limit: 1, asOfLedger: 4294967295 } };
  const result = await graph(warehouse, holderQuery, variables);
  expect(result.errors[0].message).toContain('Int cannot represent non 32-bit signed integer value');
  pinned('holder-uint32-input.json', { kind: 'synthetic-design-fixture', rest: { response }, graphql: {
    request: { query: holderQuery, variables }, responseBody: result,
    expectedHttpStatus: null, statusNote: 'Schema coercion checked; adapter HTTP status is not asserted by this socket-free test.' } });
});

test('account cursor cannot move to another account and reserved characters do not imply a valid cursor', async () => {
  const first = await rest(designWarehouse(), `/v1/analytics/accounts/${account}/balances?limit=1`);
  const after = first.body.nextCursor;
  const mismatch = await pair('account-cursor-wrong-account', `/v1/analytics/accounts/${issuer}/balances?limit=1&after=${encodeURIComponent(after)}`,
    accountQuery, { account: issuer, input: { limit: 1, after } }, designWarehouse(), 400);
  expect(mismatch.graphql.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  const invalid = 'abc+/=';
  const reserved = await pair('account-cursor-noncanonical', `/v1/analytics/accounts/${account}/balances?limit=1&after=${encodeURIComponent(invalid)}`,
    accountQuery, { account, input: { limit: 1, after: invalid } }, designWarehouse(), 400);
  expect(reserved.graphql.errors[0].extensions.code).toBe('BAD_USER_INPUT');
  expect(reserved.warehouse.calls).toHaveLength(0);
});

test('holder composite cursor rejects a changed selection', async () => {
  const first = await rest(designWarehouse(), `/v1/assets/${encodeURIComponent(asset)}/holders?limit=1&sort=balance&order=desc`);
  const after = first.body.nextCursor;
  const result = await pair('holder-cursor-changed-sort', `/v1/assets/${encodeURIComponent(asset)}/holders?limit=1&sort=account&order=desc&after=${encodeURIComponent(after)}`,
    holderQuery, { asset, input: { limit: 1, sort: 'account', order: 'desc', after } }, designWarehouse(), 400);
  expect(result.graphql.errors[0].extensions.code).toBe('BAD_USER_INPUT');
});

test('transaction operation cursor cannot be used as an effects cursor', async () => {
  const path = `/v1/analytics/transactions/${transactionHash}?view=typed&limit=1`;
  const first = await rest(designWarehouse(), path);
  const after = first.body.operations.nextCursor;
  const result = await pair('transaction-cursor-wrong-relation', path + '&effects_after=' + encodeURIComponent(after), transactionQuery,
    { hash: transactionHash, limit: 1, effectsAfter: after }, designWarehouse(), 400);
  expect(result.graphql.errors[0].extensions.code).toBe('BAD_USER_INPUT');
});

test('typed transaction hints retain their actual positive signed32 boundary', () => {
  const input = { transactionHash, ledgerSequence: 2147483647, limit: 1 };
  expect(normalizeTransactionInput(input)).toEqual(input);
  const rejected = [0, -1, 2147483648, 4294967295, 1.5].map(ledgerSequence => {
    expect(() => normalizeTransactionInput({ ...input, ledgerSequence })).toThrow('ledgerSequence must be an integer between 1 and 2147483647');
    return ledgerSequence;
  });
  pinned('transaction-ledger-boundary.json', { kind: 'synthetic-design-fixture', validator: 'normalizeTransactionInput', accepted: input,
    rejectedLedgerSequences: rejected, expectedError: 'ledgerSequence must be an integer between 1 and 2147483647' });
});

test('empty account observations stay200 and typed transaction absence is REST404 versus GraphQL null', async () => {
  const empty = await pair('account-empty', `/v1/analytics/accounts/${account}/balances?limit=1`, accountQuery,
    { account, input: { limit: 1 } }, designWarehouse({ empty: true }));
  expect(empty.rest.balances).toEqual([]);
  expect(empty.rest.nextCursor).toBeNull();
  expect(empty.graphql.errors).toBeUndefined();
  const absent = designWarehouse();
  absent.transactionDetail = async () => null;
  const result = await pair('transaction-not-found', `/v1/analytics/transactions/${transactionHash}?view=typed&limit=1`, transactionQuery,
    { hash: transactionHash, limit: 1 }, absent, 404);
  expect(result.rest.code).toBe('hubble_not_found');
  expect(result.graphql).toEqual({ data: { hubbleTransaction: null } });
});

test('unavailable warehouse is a failure rather than an empty successful page', async () => {
  const warehouse = designWarehouse();
  warehouse.accountBalances = async () => { throw new HubbleWarehouseUnavailableError('Synthetic unavailable fixture'); };
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await pair('account-unavailable', `/v1/analytics/accounts/${account}/balances?limit=1`, accountQuery,
      { account, input: { limit: 1 } }, warehouse, 503);
    expect(result.rest.code).toBe('hubble_warehouse_unavailable');
    expect(result.graphql.errors[0].extensions.code).toBe('SERVICE_UNAVAILABLE');
    expect(result.graphql.data).toBeNull();
  } finally { errors.mockRestore(); }
});
