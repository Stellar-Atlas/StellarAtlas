export const transferAccount = 'G' + 'A'.repeat(55);
export const transferDigest = 'a'.repeat(64);
export const transferBatch = '00000000-0000-0000-0000-000000000001';
export const exactTransferAmount = '9007199254740993123456789';

export function transferRow(
	overrides: Record<string, unknown> = {}
): Record<string, unknown> {
	return {
		ledger_sequence: 63,
		closed_at: '2026-09-01 00:00:00.000',
		transaction_hash: 'a'.repeat(64),
		transaction_id: '9007199254740993',
		operation_id: '9007199254740994',
		from: transferAccount,
		to: 'G' + 'B'.repeat(55),
		to_muxed: null,
		asset: 'native',
		asset_type: 'native',
		asset_code: null,
		asset_issuer: null,
		contract_id: 'C' + 'A'.repeat(55),
		event_topic: 'transfer',
		amount_raw: exactTransferAmount,
		cursor_row: '10',
		cursor_batch: transferBatch,
		cursor_digest: transferDigest,
		...overrides
	};
}
