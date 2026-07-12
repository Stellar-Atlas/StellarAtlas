import type { EntityManager } from 'typeorm';

export interface HistoryArchiveObjectRedundantIndexPair {
	readonly firstIndex: string;
	readonly firstIndexBytes: number;
	readonly secondIndex: string;
	readonly secondIndexBytes: number;
}

interface RedundantIndexRow {
	readonly firstIndex: string;
	readonly firstIndexBytes: number | string;
	readonly secondIndex: string;
	readonly secondIndexBytes: number | string;
}

export async function auditHistoryArchiveObjectRedundantIndexes(
	manager: EntityManager
): Promise<readonly HistoryArchiveObjectRedundantIndexPair[]> {
	const rows = (await manager.query(
		redundantIndexAuditSql
	)) as readonly RedundantIndexRow[];
	return rows.map((row) => ({
		firstIndex: row.firstIndex,
		firstIndexBytes: Number(row.firstIndexBytes),
		secondIndex: row.secondIndex,
		secondIndexBytes: Number(row.secondIndexBytes)
	}));
}

export const redundantIndexAuditSql = `
	select
		first_index.indexrelid::regclass::text as "firstIndex",
		pg_relation_size(first_index.indexrelid)::bigint as "firstIndexBytes",
		second_index.indexrelid::regclass::text as "secondIndex",
		pg_relation_size(second_index.indexrelid)::bigint as "secondIndexBytes"
	from pg_index first_index
	join pg_index second_index
		on second_index.indrelid = first_index.indrelid
		and second_index.indexrelid > first_index.indexrelid
		and second_index.indisunique = first_index.indisunique
		and second_index.indkey::text = first_index.indkey::text
		and second_index.indclass::text = first_index.indclass::text
		and second_index.indcollation::text = first_index.indcollation::text
		and second_index.indoption::text = first_index.indoption::text
		and coalesce(
			pg_get_expr(second_index.indexprs, second_index.indrelid), ''
		) = coalesce(pg_get_expr(first_index.indexprs, first_index.indrelid), '')
		and coalesce(
			pg_get_expr(second_index.indpred, second_index.indrelid), ''
		) = coalesce(pg_get_expr(first_index.indpred, first_index.indrelid), '')
	where first_index.indrelid = 'history_archive_object_queue'::regclass
		and first_index.indisvalid
		and second_index.indisvalid
	order by "firstIndex", "secondIndex"
`;
