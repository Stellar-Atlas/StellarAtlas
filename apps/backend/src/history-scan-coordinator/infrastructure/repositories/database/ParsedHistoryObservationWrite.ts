import type { EntityManager } from 'typeorm';

interface ObservationWrite {
	readonly parsedRowColumn: string;
	readonly parsedRowIds: readonly number[];
	readonly table: string;
}

export interface LedgerObservationWrite {
	readonly closedAt: Date | null;
	readonly parsedRowId: number;
}

interface ReturnedObservation {
	readonly id: number | string;
}

export async function recordLedgerObservations(
	manager: EntityManager,
	sourceObjectRemoteId: string,
	observedAt: Date,
	observations: readonly LedgerObservationWrite[]
): Promise<number> {
	if (observations.length === 0) return 0;
	const parameters: unknown[] = [];
	const placeholders = observations.map((observation) => {
		const values = [
			observation.parsedRowId,
			sourceObjectRemoteId,
			observedAt,
			observation.closedAt
		];
		return `(${values.map((value) => `$${parameters.push(value)}`).join(', ')})`;
	});
	const rows = await manager.query<ReturnedObservation[]>(
		`
			insert into "parsed_ledger_header_observation" as stored (
				"parsedLedgerHeaderId", "sourceObjectRemoteId", "observedAt", "closedAt"
			) values ${placeholders.join(',\n')}
			on conflict ("parsedLedgerHeaderId", "sourceObjectRemoteId") do update set
				"observedAt" = greatest(stored."observedAt", excluded."observedAt"),
				"closedAt" = coalesce(stored."closedAt", excluded."closedAt")
			where stored."closedAt" is null
				or excluded."closedAt" is null
				or stored."closedAt" = excluded."closedAt"
			returning "id"
		`,
		parameters
	);
	return rows.length;
}

export async function recordTransactionObservations(
	manager: EntityManager,
	sourceObjectRemoteId: string,
	observedAt: Date,
	table:
		| 'parsed_transaction_envelope_observation'
		| 'parsed_transaction_result_observation',
	parsedRowColumn: 'parsedTransactionEnvelopeId' | 'parsedTransactionResultId',
	parsedRowIds: readonly number[]
): Promise<void> {
	await writeObservations(manager, sourceObjectRemoteId, observedAt, {
		parsedRowColumn,
		parsedRowIds,
		table
	});
}

async function writeObservations(
	manager: EntityManager,
	sourceObjectRemoteId: string,
	observedAt: Date,
	write: ObservationWrite
): Promise<void> {
	if (write.parsedRowIds.length === 0) return;

	const parameters: unknown[] = [];
	const columns = [write.parsedRowColumn, 'sourceObjectRemoteId', 'observedAt'];
	const placeholders = write.parsedRowIds.map((parsedRowId) => {
		const values = [parsedRowId, sourceObjectRemoteId, observedAt];
		return `(${values.map((value) => `$${parameters.push(value)}`).join(', ')})`;
	});
	const quotedColumns = columns.map(quoteIdentifier).join(', ');
	const conflictColumns = [write.parsedRowColumn, 'sourceObjectRemoteId']
		.map(quoteIdentifier)
		.join(', ');
	await manager.query(
		`
			insert into ${quoteIdentifier(write.table)} as stored (${quotedColumns})
			values ${placeholders.join(',\n')}
			on conflict (${conflictColumns}) do update set
				"observedAt" = greatest(stored."observedAt", excluded."observedAt")
		`,
		parameters
	);
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
