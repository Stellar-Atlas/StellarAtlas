import type { EntityManager } from 'typeorm';
import type {
	FullHistoryLedgerProjection,
	FullHistoryStateCanonicalCoverageClaim
} from '../../../domain/full-history-state-import/FullHistoryLedgerProjection.js';

interface ProjectionRow {
	readonly bucketListHash: Buffer;
	readonly closedAt: Date;
	readonly ledgerHash: Buffer;
	readonly ledgerSequence: string;
	readonly previousLedgerHash: Buffer;
	readonly protocolVersion: number;
	readonly transactionCount: number;
	readonly transactionResultSetHash: Buffer;
	readonly transactionSetHash: Buffer;
}

export async function assertStoredFullHistoryLedgerProjections(
	manager: EntityManager,
	claim: FullHistoryStateCanonicalCoverageClaim,
	expected: readonly FullHistoryLedgerProjection[]
): Promise<void> {
	const rows = await manager.query<ProjectionRow[]>(
		`select "ledger_sequence"::text as "ledgerSequence",
			"ledger_hash" as "ledgerHash",
			"previous_ledger_hash" as "previousLedgerHash",
			"transaction_set_hash" as "transactionSetHash",
			"transaction_result_hash" as "transactionResultSetHash",
			"bucket_list_hash" as "bucketListHash",
			"protocol_version" as "protocolVersion", "closed_at" as "closedAt",
			"transaction_count" as "transactionCount"
		 from "full_history_lcm_ledger_projection"
		 where "batch_id" = $1 and "ledger_sequence" = any($2::bigint[])
		 order by "ledger_sequence"`,
		[claim.batchId, expected.map((row) => row.ledgerSequence)]
	);
	if (
		rows.length !== expected.length ||
		rows.some((row, index) => !projectionMatches(row, expected[index]!))
	) {
		throw new Error('Stored ledger projections differ from exported evidence');
	}
}

function projectionMatches(
	actual: ProjectionRow,
	expected: FullHistoryLedgerProjection
): boolean {
	return (
		actual.ledgerSequence === expected.ledgerSequence &&
		hex(actual.ledgerHash) === expected.ledgerHash &&
		hex(actual.previousLedgerHash) === expected.previousLedgerHash &&
		hex(actual.transactionSetHash) === expected.transactionSetHash &&
		hex(actual.transactionResultSetHash) ===
			expected.transactionResultSetHash &&
		hex(actual.bucketListHash) === expected.bucketListHash &&
		actual.protocolVersion === expected.protocolVersion &&
		BigInt(actual.closedAt.getTime()) === BigInt(expected.closedAtUnixMillis) &&
		BigInt(actual.transactionCount) === BigInt(expected.transactionCount)
	);
}

function hex(value: Uint8Array): string {
	return Buffer.from(value).toString('hex');
}
