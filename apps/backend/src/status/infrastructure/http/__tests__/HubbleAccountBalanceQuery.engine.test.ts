import { StrKey } from '@stellar/stellar-sdk';
import { queryHubbleAccountBalances } from '../HubbleAccountBalanceQuery.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;
const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const issuer = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
engineTest(
	'account balance SQL against ClickHouse inline data, never production tables',
	() => {
		const fields =
			'account_id String,balance Float64,buying_liabilities Float64,selling_liabilities Float64,last_modified_ledger Int64,ledger_sequence Int64,deleted Bool,_row_number UInt32,_ingested_at UInt32,_batch_id String,_source_sha256 String,asset_code String,asset_issuer String,asset_type String,trust_line_limit Int64,flags Int64';
		const row = (
			code: string,
			balance: number,
			ledger: number,
			deleted = false,
			batch = 'b2',
			digest = 's2'
		) =>
			"('" +
			account +
			"'," +
			balance +
			',1.5,2.5,' +
			ledger +
			',' +
			ledger +
			',' +
			deleted +
			',1,' +
			ledger +
			",'" +
			batch +
			"','" +
			digest +
			"','" +
			code +
			"','" +
			issuer +
			"','credit_alphanum4',9223372036854775807,1)";
		const accounts =
			"SELECT * FROM values('" +
			fields +
			"'," +
			row('', 1, 10, false, 'b1', 's1') +
			',' +
			row('', 0, 20) +
			',' +
			row('', 999, 30, false, 'b3', 's3') +
			')';
		const trustlines =
			"SELECT * FROM values('" +
			fields +
			"'," +
			[
				row('USD', 1, 10, false, 'b1', 's1'),
				row('USD', 7.5, 20),
				row('USD', 999, 30, false, 'b3', 's3'),
				row('EUR', 1, 10, false, 'b1', 's1'),
				row('EUR', 1, 20, true),
				row('ZERO', 0, 20),
				row('BAD', 123, 20, false, 'b2', 'wrong-digest'),
				row('FAIL', 123, 20, false, 'b4', 's4')
			].join(',') +
			')';
		const batches =
			"SELECT * FROM values('batch_id String,source_sha256 String,status String,updated_at UInt32',('b1','s1','complete',10),('b2','s2','complete',20),('b3','s3','failed',30),('b4','s4','complete',10),('b4','s4','started',20))";
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				// Values is not a MergeTree storage and rejects PREWHERE. Preserve the
				// identical filter semantics here; live EXPLAIN + a bounded source-SQL
				// acceptance query cover the account-only early-read stage separately.
				const query = sql
					.replace(
						/PREWHERE account_id = \{account:String\}([^\n]*)\n\t\tWHERE /g,
						'WHERE account_id = {account:String}$1 AND '
					)
					.replaceAll('`stellar_hubble`.accounts', '(' + accounts + ')')
					.replaceAll('`stellar_hubble`.trustlines', '(' + trustlines + ')')
					.replaceAll(
						'`stellar_hubble`._ingestion_batches',
						'(' + batches + ')'
					);
				if (query.includes('`stellar_hubble`.'))
					throw new Error('Physical fixture table remained');
				const url = new URL(endpoint!);
				url.searchParams.set('query', query);
				for (const p of parameters)
					url.searchParams.set('param_' + p.name, p.value);
				const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
				const response = await fetch(url, {
					method: 'POST',
					signal: AbortSignal.timeout(10000),
					headers: user
						? {
								Authorization:
									'Basic ' +
									Buffer.from(
										user +
											':' +
											(process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
									).toString('base64')
							}
						: {}
				});
				const body = await response.text();
				if (!response.ok) throw new Error(body);
				return JSON.parse(body) as { data: readonly T[] };
			}
		};
		const catalog = {
			coverage: summarizeHubbleLedgerCoverage([]),
			generatedAt: '2026-09-07T00:00:00.000Z'
		};
		it('selects same-row latest native/issued state, excludes incomplete/deleted/digest-mismatched rows, preserveszero, and pages without repeats', async () => {
			const first = await queryHubbleAccountBalances(
				executor,
				{ account, limit: 1 },
				catalog
			);
			expect(first.balances).toEqual([
				expect.objectContaining({
					asset: 'native',
					balance: 0,
					observedLedger: 20,
					balanceRaw: null
				})
			]);
			const second = await queryHubbleAccountBalances(
				executor,
				{ account, limit: 1, after: first.nextCursor! },
				catalog
			);
			expect(second.balances).toEqual([
				expect.objectContaining({
					asset: 'USD:' + issuer,
					balance: 7.5,
					buyingLiabilities: 1.5,
					observedLedger: 20,
					trustLineLimitRaw: '9223372036854775807'
				})
			]);
			const third = await queryHubbleAccountBalances(
				executor,
				{ account, limit: 1, after: second.nextCursor! },
				catalog
			);
			expect(third.balances).toEqual([
				expect.objectContaining({ asset: 'ZERO:' + issuer, balance: 0 })
			]);
			expect(third.nextCursor).toBeNull();
			const absent = await queryHubbleAccountBalances(
				executor,
				{ account: issuer },
				catalog
			);
			expect(absent.balances).toEqual([]);
		}, 30000);
	}
);
