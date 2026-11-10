import type { DataSource } from 'typeorm';
import type { PendingPlan } from './FullHistoryLedgerCloseMetaPendingPlan.js';

interface SourcePublication {
	readonly id: string;
	readonly digest: string;
	readonly start: number;
	readonly end: number;
	readonly publisherTip: number | null;
}

// Match hubble-etl/internal/catalog/catalog_recent.go: bound the batch rows
// before joining their source datasets. A bare batch tip is not publisher evidence.
const publisherTipQuery = `
	SELECT max(recent.end_ledger)::text
	FROM (
		SELECT id, end_ledger, network_passphrase_hash
		FROM full_history_ledger_close_meta_batch
		WHERE network_passphrase_hash=$1
		ORDER BY start_ledger DESC, id DESC
		LIMIT 128
	) recent
	JOIN full_history_ledger_close_meta_dataset d
		ON d.batch_id=recent.id AND d.network_passphrase_hash=recent.network_passphrase_hash
		AND d.dataset='ledger-close-meta'`;

export async function readCurrentSourcePublication(
	dataSource: DataSource, plan: PendingPlan, includePublisherTip = false
): Promise<SourcePublication | null> {
	try {
		return await dataSource.transaction(async (manager) => {
			await manager.query("SET TRANSACTION READ ONLY; SET LOCAL statement_timeout = '1000ms'; SET LOCAL lock_timeout = '100ms'");
			const rows = await manager.query<unknown[]>(
				`SELECT b.id::text AS id, b.source_id::text AS source_id,
					encode(b.config_digest, 'hex') AS config_digest, b.ledger_count,
					encode(d.output_sha256, 'hex') AS digest,
					CASE WHEN $4::boolean THEN (${publisherTipQuery}) ELSE NULL END AS publisher_tip
				FROM full_history_ledger_close_meta_batch b
				LEFT JOIN full_history_ledger_close_meta_dataset d
					ON d.batch_id=b.id AND d.network_passphrase_hash=b.network_passphrase_hash
					AND d.dataset='ledger-close-meta'
				WHERE b.network_passphrase_hash=$1 AND b.start_ledger=$2 AND b.end_ledger=$3
				LIMIT 2`,
				[Buffer.from(plan.networkPassphraseHash, 'hex'), plan.startLedger, plan.endLedger, includePublisherTip]
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
			const tip = row.publisher_tip;
			if (tip !== null && (typeof tip !== 'string' || !/^[1-9][0-9]{0,9}$/.test(tip) ||
				Number(tip) > 0xffff_ffff)) throw new Error();
			return { id: row.id, digest: row.digest, start: plan.startLedger, end: plan.endLedger,
				publisherTip: tip === null ? null : Number(tip) };
		});
	} catch {
		throw new Error('Paired current source manifest unavailable or mismatched');
	}
}
