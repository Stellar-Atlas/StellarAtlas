import type { DataSource } from 'typeorm';
import type { PendingPlan } from './FullHistoryLedgerCloseMetaPendingPlan.js';

interface SourcePublication {
	readonly id: string;
	readonly digest: string;
	readonly start: number;
	readonly end: number;
}

export async function readCurrentSourcePublication(
	dataSource: DataSource, plan: PendingPlan
): Promise<SourcePublication | null> {
	try {
		return await dataSource.transaction(async (manager) => {
			await manager.query("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '1000ms'; SET LOCAL lock_timeout = '100ms'");
			const rows = await manager.query<unknown[]>(
				`SELECT b.id::text AS id, b.source_id::text AS source_id,
					encode(b.config_digest, 'hex') AS config_digest, b.ledger_count,
					encode(d.output_sha256, 'hex') AS digest
				FROM full_history_ledger_close_meta_batch b
				LEFT JOIN full_history_ledger_close_meta_dataset d
					ON d.batch_id=b.id AND d.network_passphrase_hash=b.network_passphrase_hash
					AND d.dataset='ledger-close-meta'
				WHERE b.network_passphrase_hash=$1 AND b.start_ledger=$2 AND b.end_ledger=$3
				LIMIT 2`,
				[Buffer.from(plan.networkPassphraseHash, 'hex'), plan.startLedger, plan.endLedger]
			);
			if (rows.length === 0) return null;
			const candidate = rows[0];
			if (rows.length !== 1 || candidate === null || typeof candidate !== 'object') throw new Error();
			const row = candidate as Record<string, unknown>;
			if (typeof row.id !== 'string' ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(row.id) ||
				row.source_id !== plan.sourceId || row.config_digest !== plan.configDigest ||
				row.ledger_count !== plan.endLedger - plan.startLedger + 1 ||
				typeof row.digest !== 'string' || !/^[a-f0-9]{64}$/.test(row.digest)) throw new Error();
			return { id: row.id, digest: row.digest, start: plan.startLedger, end: plan.endLedger };
		});
	} catch {
		throw new Error('Paired current source manifest unavailable or mismatched');
	}
}
