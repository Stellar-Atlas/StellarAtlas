import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import { queryHubbleAssetHolders } from '../HubbleAssetHolderQuery.js';
import type {
	HubbleAssetHolderQuery,
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';

describe('queryHubbleAssetHolders publication', () => {
	it.each<HubbleAssetHolderQuery['asset']>([
		{ type: 'native' },
		{ type: 'issued', code: 'USD', issuer: 'GISSUER' }
	])(
		'gates $type observations before latest-balance aggregation and keeps keyset pagination',
		async (asset) => {
			let capturedSql = '';
			let capturedParameters: readonly HubblePreparedParameter[] = [];
			const executor: HubbleSemanticQueryExecutor = {
				database: 'stellar_hubble',
				maximumRows: 200,
				async execute<T>(
					sql: string,
					parameters: readonly HubblePreparedParameter[]
				) {
					if (sql.includes('._asset_holder_index_assets'))
						return { data: [{ ready: 1 }] as unknown as readonly T[] };
					capturedSql = sql;
					capturedParameters = parameters;
					return {
						data: [
							{ account_id: 'GB', balance: 2 },
							{ account_id: 'GC', balance: 3 }
						] as unknown as readonly T[]
					};
				}
			};
			const page = await queryHubbleAssetHolders(
				executor,
				{
					asset,
					after: 'GA',
					limit: 1
				},
				{
					coverage: summarizeHubbleLedgerCoverage([]),
					generatedAt: '2026-09-07T00:00:00.000Z'
				}
			);
			expect(capturedSql).toContain(
				"tupleElement(argMax(tuple(status, source_sha256), updated_at), 1) = 'complete'"
			);
			expect(capturedSql).toContain('AS published FROM snapshot');
			expect(capturedSql).toContain('throwIf(countIf(NOT published)>0');
			expect(capturedSql).toContain('AND account_id > {after:String}');
			expect(capturedSql).toContain(
				'AND tupleElement(state,9)=false AND tupleElement(state,4)>0'
			);
			expect(capturedParameters).toContainEqual({
				name: 'row_limit',
				type: 'UInt32',
				value: '2'
			});
			expect(page.holders).toEqual([{ account_id: 'GB', balance: 2 }]);
			expect(page.nextCursor).toBe('GB');
		}
	);

	it('supports as-of balance ordering and a selection-bound composite cursor', async () => {
		const sqlAndParameters: {
			sql: string;
			parameters: readonly HubblePreparedParameter[];
		}[] = [];
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				if (sql.includes('._asset_holder_index_assets'))
					return { data: [{ ready: 1 }] as unknown as readonly T[] };
				sqlAndParameters.push({ sql, parameters });
				return {
					data: [
						{
							account_id: 'GA',
							balance: 100.12345678901234,
							ledger_sequence: 48
						},
						{ account_id: 'GB', balance: 90, ledger_sequence: 50 }
					] as unknown as readonly T[]
				};
			}
		};
		const coverage = summarizeHubbleLedgerCoverage([
			{ start_ledger: 2, end_ledger: 100 }
		]);
		const catalog = { coverage, generatedAt: '2026-09-07T00:00:00.000Z' };
		const selection: HubbleAssetHolderQuery = {
			asset: { type: 'issued', code: 'USD', issuer: 'GISSUER' },
			limit: 1,
			sort: 'balance',
			order: 'desc',
			asOfLedger: 50
		};
		const firstPage = await queryHubbleAssetHolders(
			executor,
			selection,
			catalog
		);
		expect(firstPage.holders).toEqual([
			{ account_id: 'GA', balance: 100.12345678901234, ledger_sequence: 48 }
		]);
		expect(firstPage.nextCursor).toMatch(/^c\./);
		expect(firstPage.watermark).toMatchObject({
			selectedLedger: '50',
			coverageStatus: 'complete',
			balancePrecision: 'source-float64'
		});
		expect(
			sqlAndParameters[0]?.sql.indexOf(
				'ledger_sequence <= {as_of_ledger:UInt32}'
			)
		).toBeLessThan(
			sqlAndParameters[0]?.sql.indexOf('GROUP BY account_id') ?? -1
		);
		expect(sqlAndParameters[0]?.sql).toContain(
			'ORDER BY _latest_balance DESC, account_id ASC'
		);
		expect(sqlAndParameters[0]?.parameters).toContainEqual({
			name: 'as_of_ledger',
			type: 'UInt32',
			value: '50'
		});
		await queryHubbleAssetHolders(
			executor,
			{ ...selection, after: firstPage.nextCursor! },
			catalog
		);
		expect(sqlAndParameters[1]?.sql).toContain(
			'_latest_balance < {after_balance:Float64}'
		);
		expect(sqlAndParameters[1]?.sql).toContain(
			'account_id > {after_account:String}'
		);
		expect(sqlAndParameters[1]?.parameters).toContainEqual({
			name: 'after_balance',
			type: 'Float64',
			value: '100.12345678901234'
		});
		await expect(
			queryHubbleAssetHolders(
				executor,
				{
					...selection,
					asset: { type: 'issued', code: 'EUR', issuer: 'GISSUER' },
					after: firstPage.nextCursor!
				},
				catalog
			)
		).rejects.toThrow(/mismatched holder cursor/);
	});

	it('keeps the legacy account cursor and applies deletions after as-of argMax', async () => {
		const capturedSql: string[] = [];
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble',
			maximumRows: 200,
			async execute<T>(sql: string) {
				if (sql.includes('._asset_holder_index_assets'))
					return { data: [{ ready: 1 }] as unknown as readonly T[] };
				capturedSql.push(sql);
				return {
					data: [
						{ account_id: 'GB', balance: 2 },
						{ account_id: 'GC', balance: 3 }
					] as unknown as readonly T[]
				};
			}
		};
		const coverage = summarizeHubbleLedgerCoverage([
			{ start_ledger: 2, end_ledger: 100 }
		]);
		const page = await queryHubbleAssetHolders(
			executor,
			{
				asset: { type: 'issued', code: 'USD', issuer: 'GISSUER' },
				limit: 1,
				asOfLedger: 65
			},
			{ coverage, generatedAt: '2026-09-07T00:00:00.000Z' }
		);
		expect(capturedSql[0]).toContain('argMax(deleted');
		expect(capturedSql[0]).toContain(
			'WHERE 1 AND _latest_deleted = false AND _latest_balance > 0'
		);
		expect(page.nextCursor).toMatch(/^c\./);
		await queryHubbleAssetHolders(
			executor,
			{
				asset: { type: 'issued', code: 'USD', issuer: 'GISSUER' },
				after: 'GA',
				limit: 1
			},
			{ coverage, generatedAt: '2026-09-07T00:00:00.000Z' }
		);
		expect(capturedSql[1]).toContain('AND account_id > {after:String}');
	});

	it('does not claim complete as-of state when history lacks a ledger-two baseline', async () => {
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble',
			maximumRows: 200,
			async execute<T>() {
				return { data: [] as unknown as readonly T[] };
			}
		};
		const page = await queryHubbleAssetHolders(
			executor,
			{ asset: { type: 'native' }, asOfLedger: 80 },
			{
				coverage: summarizeHubbleLedgerCoverage([
					{ start_ledger: 50, end_ledger: 100 }
				]),
				generatedAt: '2026-09-07T00:00:00.000Z'
			}
		);
		expect(page.watermark).toMatchObject({
			selectedLedger: '80',
			coverageStatus: 'partial_or_unknown'
		});
	});
});
