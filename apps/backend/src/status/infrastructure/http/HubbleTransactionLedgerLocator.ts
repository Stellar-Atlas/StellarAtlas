import { createHash } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import { normalizeTransactionInput } from './HubbleTransactionCursor.js';

export type HubbleTransactionLedgerLocator = (
	hash: string
) => Promise<number | null>;

export const hubbleTransactionLedgerLocatorSql = `
SELECT ledger_sequence::text AS ledger_sequence
FROM full_history_transaction
WHERE network_passphrase_hash = $1 AND transaction_hash = $2
LIMIT 1`;

export async function withBoundedHubbleTransactionLocatorRead<T>(
	dataSource: DataSource,
	read: (manager: EntityManager) => Promise<T>
): Promise<T> {
	// Server cancellation, followed by TypeORM rollback/release, not a timer
	// racing an orphaned query. These bounds never affect other pooled work.
	return dataSource.transaction('READ COMMITTED', async (manager) => {
		await manager.query(
			"set transaction read only; set local statement_timeout = '750ms'; set local lock_timeout = '100ms'"
		);
		return read(manager);
	});
}

export function createPostgresHubbleTransactionLedgerLocator(
	dataSource: DataSource,
	networkPassphrase: string
): HubbleTransactionLedgerLocator {
	const networkHash = createHash('sha256').update(networkPassphrase).digest();
	return async (hash) => {
		const input = normalizeTransactionInput({ transactionHash: hash });
		const rows: { ledger_sequence: string }[] =
			await withBoundedHubbleTransactionLocatorRead(dataSource, (manager) =>
				manager.query(hubbleTransactionLedgerLocatorSql, [
					networkHash,
					Buffer.from(input.transactionHash, 'hex')
				])
			);
		const ledger = rows[0]?.ledger_sequence;
		if (typeof ledger !== 'string' || !/^[0-9]+$/.test(ledger)) return null;
		const value = Number(ledger);
		return Number.isSafeInteger(value) && value >= 1 && value <= 2147483647
			? value
			: null;
	};
}
