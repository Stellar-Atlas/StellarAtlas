import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { jest, test, expect } from '@jest/globals';
import { fixtureHttp } from './http-fixture.mjs';
import { account, asset, transactionHash, accountQuery, designWarehouse } from './design-data.mjs';
import { HubbleWarehouseUnavailableError } from '../../apps/backend/src/status/infrastructure/http/HubbleWarehouseErrors.js';

const folder = fileURLToPath(new URL('./fixtures/', import.meta.url));
function pinned(name, values) {
  const text = '[\n' + values.map(value => '  ' + JSON.stringify(value)).join(',\n') + '\n]\n';
  expect(fs.readFileSync(folder + name, 'utf8')).toBe(text);
}

test('real HTTP negotiation distinguishes parse, validation, coercion and execution outcomes', async () => {
  const expensive = 'query($account:String!){' + Array.from({ length: 5 }, (_, i) =>
    `page${i}:hubbleAccountBalances(account:$account,input:{limit:1}){account}`).join(' ') + '}';
  const cases = [
    { name: 'success', body: { query: '{__typename}' } },
    { name: 'syntax', body: { query: 'query {' } },
    { name: 'schema', body: { query: '{unknownReadField}' } },
    { name: 'coercion', body: { query: accountQuery, variables: { account, input: { limit: 'invalid' } } } },
    { name: 'resolver', body: { query: accountQuery, variables: { account, input: { limit: 201 } } } },
    { name: 'budget', body: { query: expensive, variables: { account } } },
    { name: 'unavailable', body: { query: accountQuery, variables: { account, input: { limit: 1 } } } }
  ];
  const results = [];
  const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    for (const accept of ['application/json', 'application/graphql-response+json']) {
      for (const item of cases) {
        const warehouse = designWarehouse();
        if (item.name === 'unavailable') warehouse.accountBalances = async () => {
          throw new HubbleWarehouseUnavailableError('Synthetic unavailable fixture');
        };
        const response = await fixtureHttp(warehouse, { accept, body: item.body });
        const status = accept === 'application/graphql-response+json' && ['syntax', 'schema', 'budget'].includes(item.name) ? 400 : 200;
        expect(response.status).toBe(status);
        expect(response.contentType).toContain(accept);
        if (item.name === 'success') expect(response.body).toEqual({ data: { __typename: 'Query' } });
        else expect(response.body.errors.length).toBeGreaterThan(0);
        if (['syntax', 'schema', 'coercion', 'resolver', 'budget'].includes(item.name)) expect(warehouse.calls).toHaveLength(0);
        results.push({ kind: 'synthetic-design-fixture', case: item.name,
          request: { method: 'POST', path: '/graphql', accept, body: item.body }, response });
      }
    }
    const unsupported = await fixtureHttp(designWarehouse(), { accept: 'text/plain', body: { query: '{__typename}' } });
    expect(unsupported.status).toBe(406);
    results.push({ kind: 'synthetic-design-fixture', case: 'unsupported-accept',
      request: { method: 'POST', path: '/graphql', accept: 'text/plain', body: { query: '{__typename}' } }, response: unsupported });
  } finally { errors.mockRestore(); }
  pinned('http-negotiation.json', results);
});

test('final public mount preserves selected REST namespaces with synthetic warehouse services', async () => {
  const paths = [
    `/v1/analytics/accounts/${account}/balances?limit=1`,
    `/v1/assets/${encodeURIComponent(asset)}/holders?limit=1`,
    `/v1/analytics/transactions/${transactionHash}?view=typed&limit=1`,
    `/v1/analytics/accounts/${account}/balances?as_of_ledger=65`
  ];
  const results = [];
  for (const [index, path] of paths.entries()) {
    const response = await fixtureHttp(designWarehouse(), { method: 'GET', path });
    expect(response.status).toBe(index === 3 ? 400 : 200);
    expect(response.contentType).toContain('application/json');
    if (index === 0) expect(response.body.account).toBe(account);
    if (index === 1) expect(response.body.asset).toBe(asset);
    if (index === 2) expect(response.body.transaction.hash).toBe(transactionHash);
    if (index === 3) expect(response.body.code).toBe('invalid_hubble_query');
    results.push({ kind: 'synthetic-design-fixture', request: { method: 'GET', path }, response });
  }
  pinned('rest-mount.json', results);
});
