import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const revision = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Supply the reviewed 40-character contract source revision.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const http = 'apps/backend/src/status/infrastructure/http/';
const api = 'apps/backend/src/core/infrastructure/http/';
const contractFiles = [
  'api.ts', 'PublicOpenApiDocument.ts', 'HubbleOpenApiDocument.ts', 'AssetResourceOpenApi.ts',
  'OpenApiDocumentProjection.ts', 'HubbleAccountBalanceOpenApi.ts', 'HubbleTransactionOpenApi.ts',
  'HubbleSemanticOpenApiPaths.ts', 'HubbleSemanticOpenApiSchemas.ts', 'HubbleSemanticOpenApiParameters.ts'
].map(name => api + name).concat([
  'HubbleWarehouseGraphql.ts', 'HubbleAccountBalanceGraphql.ts', 'HubbleAssetHolderGraphql.ts',
  'HubbleTransactionGraphql.ts', 'HubbleTransferGraphql.ts', 'HubbleContractEventGraphql.ts',
  'HubbleAssetReportGraphql.ts', 'HubbleExplorerGraphql.ts', 'HubbleGraphqlBudget.ts',
  'HubbleAccountBalanceContracts.ts', 'HubbleTransactionContracts.ts', 'HubbleSemanticWarehouse.ts',
  'HubbleAccountBalanceRoutes.ts', 'HubbleTransactionRoutes.ts', 'HubbleSemanticRoutes.ts',
  'HubbleSemanticRouteHelpers.ts', 'HubbleAccountBalanceQuery.ts', 'HubbleAssetHolderQuery.ts',
  'HubbleTransactionQuery.ts', 'HubbleTransactionMapper.ts', 'HubbleTransactionEnvelope.ts',
  'HubbleAccountBalanceCursor.ts', 'HubbleTransactionCursor.ts', 'HubbleLedgerCoverage.ts',
  'HubbleWarehouseErrors.ts', 'asset-catalogue/AssetResourceRouter.ts',
  'PublicDataRoutes.ts', 'PublicGoodsRouter.ts', 'PublicGoodsReadinessReader.ts',
  '__tests__/HubbleAccountBalanceGraphql.test.ts', '__tests__/HubbleTransactionApi.integration.test.ts',
  '__tests__/HubbleTransactionFixture.ts'
].map(name => http + name), ['apps/backend/package.json', 'pnpm-lock.yaml']);
const sourceFiles = contractFiles.map(file => {
  const committed = execFileSync('git', ['show', revision + ':' + file], {
    cwd: root, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' }
  });
  const current = fs.readFileSync(path.join(root, file));
  if (!committed.equals(current)) throw new Error('Source differs from reviewed revision: ' + file);
  return { path: file, sha256: hash(current) };
});
const folder = path.join(root, 'docs/sdk-contracts/fixtures');
const fixtures = fs.readdirSync(folder).sort().map(name => ({ path: 'fixtures/' + name, sha256: hash(fs.readFileSync(path.join(folder, name))) }));
const result = { status: 'synthetic design fixtures; no SDK release', sourceRevision: revision,
  sourceUrl: 'https://github.com/Stellar-Atlas/StellarAtlas/tree/' + revision,
  schemaProjection: 'Selected OpenAPI operations and three reachable GraphQL workflow fields; full GraphQL digest retained.',
  sourceFiles, fixtures };
fs.writeFileSync(path.join(root, 'docs/sdk-contracts/manifest.json'), JSON.stringify(result, null, 2) + '\n');
