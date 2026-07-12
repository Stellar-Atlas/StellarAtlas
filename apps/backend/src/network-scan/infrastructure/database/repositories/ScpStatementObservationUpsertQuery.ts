import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';

export interface ScpStatementObservationUpsertQuery {
	parameters: unknown[];
	sql: string;
}

const columns = [
	'nodeId',
	'observedAt',
	'observedFromAddress',
	'observedFromPeer',
	'pledges',
	'signature',
	'slotIndex',
	'statementHash',
	'statementType',
	'statementXdr',
	'values'
] as const;

const updateColumns = columns.filter((column) => column !== 'statementHash');

const preferenceColumns = [
	'observedAt',
	'observedFromPeer',
	'observedFromAddress',
	'nodeId',
	'signature',
	'slotIndex',
	'statementType',
	'statementXdr'
] as const;

export function createScpStatementObservationUpsertQuery(
	observations: readonly CrawlerScpStatementObservation[]
): ScpStatementObservationUpsertQuery {
	const parameters: unknown[] = [];
	const rows = observations.map((observation) => {
		const entity = new ScpStatementObservation(observation);
		const values: unknown[] = [
			entity.nodeId,
			entity.observedAt,
			entity.observedFromAddress,
			entity.observedFromPeer,
			JSON.stringify(entity.pledges),
			entity.signature,
			entity.slotIndex,
			entity.statementHash,
			entity.statementType,
			entity.statementXdr,
			JSON.stringify(entity.values)
		];
		const offset = parameters.length;
		parameters.push(...values);
		return `(${values
			.map((_, index) => parameterPlaceholder(offset + index + 1, index))
			.join(', ')})`;
	});

	return {
		parameters,
		sql: `
			with changed_observations as (
				insert into scp_statement_observation as stored (
				${columns.map(quoteIdentifier).join(', ')}
				)
				values ${rows.join(', ')}
				on conflict ("statementHash") do update set
				${updateColumns
					.map(
						(column) =>
							`${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`
					)
					.join(',\n\t\t\t\t')}
				where row(
				${preferenceColumns
					.map((column) => `excluded.${quoteIdentifier(column)}`)
					.concat(['excluded."pledges"::text', 'excluded."values"::text'])
					.join(', ')}
				) > row(
				${preferenceColumns
					.map((column) => `stored.${quoteIdentifier(column)}`)
					.concat(['stored."pledges"::text', 'stored."values"::text'])
					.join(', ')}
				)
				returning "statementHash"
			)
			insert into scp_statement_projection_event ("statementHash")
			select "statementHash" from changed_observations
		`
	};
}

function parameterPlaceholder(position: number, columnIndex: number): string {
	if (columnIndex === 4 || columnIndex === 10) return `$${position}::jsonb`;
	if (columnIndex === 6) return `$${position}::numeric`;
	return `$${position}`;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier}"`;
}
