import express from 'express';
import { createServer } from 'node:http';
import { Networks } from '@stellar/stellar-sdk';
import { jest } from '@jest/globals';
import { parseAssetReference } from '../../apps/backend/src/status/infrastructure/http/asset-catalogue/AssetIdentity.js';

// The mount constructs an asset catalogue source even for GraphQL requests.
// Inject an inert service at that boundary; querying it is outside this packet.
jest.unstable_mockModule('../../apps/backend/src/status/infrastructure/http/asset-catalogue/AssetCatalogueSource.js', () => ({
  AssetCatalogueSource: class {
    async issuerHomeDomain() { throw new Error('Unexpected catalogue lookup in design fixture'); }
    async refresh() { throw new Error('Unexpected catalogue refresh in design fixture'); }
  }
}));
jest.unstable_mockModule('../../apps/backend/src/status/infrastructure/http/asset-catalogue/AssetCatalogue.js', () => ({
  AssetCatalogue: class {
    constructor(_source, _root, network) { this.network = network; }
    start() {}
    async resolve(reference) { return parseAssetReference(reference, this.network); }
  }
}));
const { mountPublicDataRoutes } = await import('../../apps/backend/src/status/infrastructure/http/PublicDataRoutes.js');

// Actual public route registration and locked HTTP adapter, synthetic services.
// Each call owns one ephemeral loopback listener and closes it before returning.
export async function fixtureHttp(warehouse, { path = '/graphql', method = 'POST', body, accept = 'application/json' }) {
  const app = express();
  app.use(express.json());
  const unexpected = async () => { throw new Error('Unexpected external service use in design fixture'); };
  mountPublicDataRoutes(app, { warehouse, networkPassphrase: Networks.PUBLIC,
    manager: { query: unexpected }, getArchiveStatusSummary: unexpected });
  const server = createServer(app);
  server.maxConnections = 8;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method, headers: { accept, 'content-type': 'application/json', connection: 'close' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)
    });
    const text = await response.text();
    return { status: response.status, contentType: response.headers.get('content-type'),
      body: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
