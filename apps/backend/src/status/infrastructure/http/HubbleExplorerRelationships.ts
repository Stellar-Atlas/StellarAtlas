import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
export async function attachExplorerTransactionHashes(
	warehouse: HubbleWarehouse,
	rows: readonly Record<string, unknown>[]
): Promise<readonly Record<string, unknown>[]> {
	if (rows.length === 0) return rows;
	const ids = [...new Set(rows.map((row) => String(row.transactionId)))];
	const ledgers = [...new Set(rows.map((row) => Number(row.ledgerSequence)))];
	const result = await warehouse.query({
		dataset: 'history_transactions',
		distinct: true,
		filters: [
			{ field: 'id', operator: 'in', values: ids },
			{ field: '_ledger_sequence', operator: 'in', values: ledgers }
		],
		select: ['id', 'transaction_hash', '_ledger_sequence'],
		limit: ids.length + 1
	});
	if (result.rows.length > ids.length)
		throw new HubbleWarehouseUnavailableError(
			'Conflicting transaction relationship rows'
		);
	const hashes = new Map<string, string>();
	for (const row of result.rows) {
		if (
			typeof row.transaction_hash !== 'string' ||
			!/^[a-f0-9]{64}$/i.test(row.transaction_hash)
		)
			throw new HubbleWarehouseUnavailableError(
				'Invalid related transaction hash'
			);
		hashes.set(
			String(row.id) + ':' + String(row._ledger_sequence),
			row.transaction_hash.toLowerCase()
		);
	}
	return rows.map((row) => ({
		...row,
		transactionHash:
			hashes.get(
				String(row.transactionId) + ':' + String(row.ledgerSequence)
			) ?? null
	}));
}
