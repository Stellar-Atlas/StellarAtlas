import {
	holderIndexSql,
	requireHolderIndex
} from './HubbleHolderIndexQuery.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import type { HubbleSemanticQueryExecutor } from './HubbleSemanticWarehouse.js';

describe('HubbleHolderIndexQuery', () => {
	it('requires a ready holder index and accepts ready=1', async () => {
		const execute = jest
			.fn()
			.mockResolvedValueOnce({ data: [{ ready: 0 }] })
			.mockResolvedValueOnce({ data: [{ rows: '0' }] })
			.mockResolvedValueOnce({ data: [{ ready: 1 }] })
			.mockResolvedValueOnce({ data: [{ ready: 0 }] })
			.mockResolvedValueOnce({ data: [{ rows: '4' }] });
		const executor = {
			database: 'stellar_hubble',
			execute
		} as unknown as HubbleSemanticQueryExecutor;

		await expect(requireHolderIndex(executor, 'USD:issuer')).rejects.toBeInstanceOf(
			HubbleWarehouseUnavailableError
		);
		await expect(requireHolderIndex(executor, 'USD:issuer')).resolves.toBe(true);
		await expect(requireHolderIndex(executor, 'USD:issuer')).resolves.toBe(false);
		expect(execute).toHaveBeenCalledTimes(5);
		expect(execute.mock.calls[0][1]).toEqual([
			{ name: 'asset_key', type: 'String', value: 'USD:issuer' }
		]);
		expect(execute.mock.calls[1][1]).toEqual([
			{ name: 'asset_key', type: 'String', value: 'USD:issuer' }
		]);
	});

	it('binds asset identity and reads only visible, non-deleted holder-index state', () => {
		const sql = holderIndexSql(
			'stellar_hubble',
			'AND account_id > {account_cursor:String}',
			'AND _latest_balance < {balance_cursor:Float64}',
			'balance',
			'desc'
		);

		expect(sql).toContain('FROM `stellar_hubble`._asset_holder_current');
		expect(sql).not.toMatch(/\b(?:trustlines|accounts)\b/);
		expect(sql).toContain('asset_key = {asset_key:String}');
		expect(sql).toContain('tupleElement(state,9)=false');
		expect(sql).toContain("= 'complete'");
		expect(sql).toContain('ORDER BY _latest_balance DESC, account_id ASC');
	});
});
