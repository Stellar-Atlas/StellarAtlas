import { FULL_HISTORY_STATE_EXPORT_VERSION } from '../../../domain/full-history-state-import/FullHistoryStateExport.js';
import { consumeFullHistoryLedgerExport } from '../FullHistoryLedgerExportProtocol.js';

describe('consumeFullHistoryLedgerExport', () => {
	it('accepts the exact ledger identity protocol without numeric precision loss', async () => {
		const rows: unknown[] = [];
		const sourceSha256 = '6'.repeat(64);
		const output = [
			{
				dataset: 'ledgers',
				sourceSha256,
				type: 'header',
				version: FULL_HISTORY_STATE_EXPORT_VERSION
			},
			{ dataset: 'ledgers', type: 'row', value: ledgerRow() },
			{ dataset: 'ledgers', recordCount: '1', type: 'complete' }
		]
			.map((event) => JSON.stringify(event))
			.join('\n');

		await expect(
			consumeFullHistoryLedgerExport(
				[Buffer.from(output)],
				sourceSha256,
				(row) => {
					rows.push(row);
					return Promise.resolve();
				}
			)
		).resolves.toEqual({ recordCount: 1n, sourceSha256 });
		expect(rows).toEqual([ledgerRow()]);
	});

	it.each([
		['uppercase hash', { ledgerHash: 'A'.repeat(64) }],
		['extra field', { unexpected: true }],
		['floating protocol', { protocolVersion: 27.5 }],
		['unsafe transaction count', { transactionCount: '2147483648' }]
	])('rejects %s', async (_name, change) => {
		const output = [
			{
				dataset: 'ledgers',
				sourceSha256: '6'.repeat(64),
				type: 'header',
				version: FULL_HISTORY_STATE_EXPORT_VERSION
			},
			{
				dataset: 'ledgers',
				type: 'row',
				value: { ...ledgerRow(), ...change }
			}
		]
			.map((event) => JSON.stringify(event))
			.join('\n');
		await expect(
			consumeFullHistoryLedgerExport(
				[Buffer.from(output)],
				'6'.repeat(64),
				() => Promise.resolve()
			)
		).rejects.toThrow();
	});
});

function ledgerRow() {
	return {
		bucketListHash: '5'.repeat(64),
		closedAtUnixMillis: '1784073600000',
		ledgerHash: '1'.repeat(64),
		ledgerSequence: '63300001',
		previousLedgerHash: '2'.repeat(64),
		protocolVersion: 27,
		transactionCount: '2147483647',
		transactionResultSetHash: '4'.repeat(64),
		transactionSetHash: '3'.repeat(64)
	};
}
