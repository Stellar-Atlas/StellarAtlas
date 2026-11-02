// Synthetic design data only. No account, balance or transaction is a live sample.
import { StrKey, TransactionBuilder, Networks } from '@stellar/stellar-sdk';
import { summarizeHubbleLedgerCoverage } from '../../apps/backend/src/status/infrastructure/http/HubbleLedgerCoverage.js';
import { queryHubbleAccountBalances } from '../../apps/backend/src/status/infrastructure/http/HubbleAccountBalanceQuery.js';
import { queryHubbleAssetHolders } from '../../apps/backend/src/status/infrastructure/http/HubbleAssetHolderQuery.js';
import { queryHubbleTransactionDetail } from '../../apps/backend/src/status/infrastructure/http/HubbleTransactionQuery.js';
import { queryFixture, transactionFixture } from '../../apps/backend/src/status/infrastructure/http/__tests__/HubbleTransactionFixture.js';

// Explicit byte-to-hex conversion also works when the installed SDK returns Uint8Array.
export const transactionHash = Buffer.from(TransactionBuilder.fromXDR(transactionFixture.tx_envelope, Networks.PUBLIC).hash()).toString('hex');
export const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
export const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
export const asset = 'USD:' + issuer;
export const clock = '2026-11-01T00:00:00.000Z';
export const catalog = {
  generatedAt: clock,
  coverage: summarizeHubbleLedgerCoverage([
    { start_ledger: 2, end_ledger: 65 }, { start_ledger: 130, end_ledger: 193 }
  ])
};
const native = {
  asset_kind: 0, asset_type: 'native', asset_code: '', asset_issuer: '',
  balance: 0, buying_liabilities: 1.25, selling_liabilities: 2.5,
  last_modified_ledger: '12', ledger_sequence: '193', flags: '0',
  trust_line_limit_raw: null
};
const issued = { ...native, asset_kind: 1, asset_type: 'credit_alphanum4',
  asset_code: 'USD', asset_issuer: issuer, balance: 0.10000000000000002,
  trust_line_limit_raw: '9223372036854775807' };
const holder = {
  account_id: account, balance: 12.25, buying_liabilities: 0.0000001,
  selling_liabilities: 0.0000002, trust_line_limit: '9223372036854775807',
  flags: '0', ledger_sequence: '193', last_modified_ledger: '12',
  asset_code: 'USD', asset_issuer: issuer, asset_type: 'credit_alphanum4',
  sponsor: null, sponsored: false, deleted: false,
  indexed_holder_count: '2', indexed_balance_total: 12.35
};

export function designWarehouse({ uint32 = false, empty = false } = {}) {
  const selectedCatalog = uint32 ? { ...catalog, coverage: summarizeHubbleLedgerCoverage([{ start_ledger: 2, end_ledger: 65 }, { start_ledger: 4294967294, end_ledger: 4294967295 }]) } : catalog;
  const calls = [];
  return {
    calls,
    async accountBalances(input) {
      calls.push({ method: 'accountBalances', input });
      const executor = { database: 'fixture', maximumRows: 200,
        async execute() { return { data: (empty ? [] : input.after ? [issued] : [native, issued]).map(row => uint32 ? { ...row, ledger_sequence: 4294967295 } : row) }; } };
      const page = await queryHubbleAccountBalances(executor, input, selectedCatalog);
      return { ...page, elapsedMilliseconds: 0 };
    },
    async assetHolders(input) {
      calls.push({ method: 'assetHolders', input });
      const executor = { database: 'fixture', maximumRows: 200,
        async execute(sql) {
          if (sql.includes('._asset_holder_index_assets')) return { data: [{ ready: 1 }] };
          return { data: input.after ? [{ ...holder, account_id: issuer, balance: '0.10000000000000001' }]
            : [holder, { ...holder, account_id: issuer, balance: '0.10000000000000001' }] };
        } };
      const page = await queryHubbleAssetHolders(executor, input, selectedCatalog);
      return { ...page, elapsedMilliseconds: 0 };
    },
    async transactionDetail(input) {
      calls.push({ method: 'transactionDetail', input });
      const original = queryFixture().executor;
      const executor = { ...original, async execute(sql, parameters) {
        const result = await original.execute(sql, parameters);
        return { ...result, data: result.data?.map(row => 'transaction_hash' in row
          ? { ...row, transaction_hash: transactionHash } : row) };
      } };
      const page = await queryHubbleTransactionDetail(executor, input);
      return page === null ? null : { ...page, observedAt: clock };
    }
  };
}

export const accountQuery = `query Account($account:String!,$input:HubbleAccountBalanceInput) {
  hubbleAccountBalances(account:$account,input:$input) {
    account balanceScope limit nextCursor elapsedMilliseconds
    balances { asset assetType assetCode assetIssuer balance balanceRaw amountPrecision buyingLiabilities sellingLiabilities trustLineLimitRaw flags lastModifiedLedger observedLedger }
    coverage { completedRanges { firstLedger lastLedger } contiguousLastLedger maximumLedger gapCount }
    watermark { mode catalogGeneratedAt catalogMaximumLedger selectedLedger snapshotPinned coverageStatus balancePrecision }
  }
}`;
export const holderQuery = `query Holders($asset:String!,$input:HubbleAssetHolderInput) {
  hubbleAssetHolders(asset:$asset,input:$input) {
    asset limit nextCursor elapsedMilliseconds
    holders { accountId balance amountPrecision buyingLiabilities sellingLiabilities trustLineLimit ledgerSequence lastModifiedLedger assetCode assetIssuer assetType flags sponsor sponsored deleted }
    coverage { completedRanges { firstLedger lastLedger } contiguousLastLedger maximumLedger gapCount }
    watermark { indexStatus mode catalogGeneratedAt catalogMaximumLedger selectedLedger snapshotPinned coverageStatus balancePrecision }
    indexedSummary { holderCount balanceTotal }
  }
}`;
export const transactionQuery = `query Transaction($hash:String!,$ledger:Int,$limit:Int,$operationsAfter:String,$effectsAfter:String,$eventsAfter:String) {
  hubbleTransaction(transactionHash:$hash,ledgerSequence:$ledger,limit:$limit,operationsAfter:$operationsAfter,effectsAfter:$effectsAfter,eventsAfter:$eventsAfter) {
    transaction { id hash ledgerSequence sequence feeChargedRaw maxFeeRaw }
    operations { limit nextCursor items { id transactionId index resultCode traceCode envelopeDecoded amounts { field decimal raw scale source } detailsJson } }
    effects { limit nextCursor items { id operationId index amounts { field decimal raw scale source } detailsJson } }
    events { limit nextCursor items { id topicsJson dataJson eventXdr classification { transactionKind eventKind sorobanExecutionEvidence provenance } } }
    coverage observedAt
  }
}`;
