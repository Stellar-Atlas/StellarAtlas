import type { DataSource } from 'typeorm';
import {
	enableFullHistoryLedgerCloseMetaCompactDatasetSetSql,
	fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql
} from '../../database/migrations/FullHistoryLedgerCloseMetaDatasetSchemaSql.js';

const metadataSql = `
	select pg_get_expr(contract.conbin, contract.conrelid) as "constraintExpression",
		assertion.prosrc as "datasetSetBody"
	from pg_catalog.pg_constraint contract
	join pg_catalog.pg_class relation on relation.oid = contract.conrelid
	join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
	join pg_catalog.pg_proc assertion
		on assertion.pronamespace = namespace.oid
		and assertion.oid = to_regprocedure(format(
			'%I.assert_full_history_lcm_batch_dataset_set(uuid)', current_schema()))
		and assertion.prokind = 'f'
	where namespace.nspname = current_schema()
		and relation.relname = 'full_history_ledger_close_meta_dataset'
		and relation.relkind = 'r'
		and contract.contype = 'c'
		and contract.conname = 'chk_full_history_lcm_dataset_contract'`;

// These are literals, not archive rows. Cover each retained allowed schema and
// the compact schema's media, representation, version and dataset boundaries.
const contractCasesSql = `
	values
	(1, 'ledger-close-meta', 'stellar-atlas.full-history.ledger-close-meta-batch.v1', 'application/x-stellar-ledger-close-meta-batch+xdr+zstd', 'lossless-replay'),
	(2, 'ledgers', 'stellar-atlas.full-history.ledgers.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(3, 'transactions', 'stellar-atlas.full-history.transactions.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(4, 'operations', 'stellar-atlas.full-history.operations.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(5, 'transaction-results', 'stellar-atlas.full-history.transaction-results.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(6, 'transaction-meta', 'stellar-atlas.full-history.transaction-meta.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(7, 'contract-events', 'stellar-atlas.full-history.contract-events.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(8, 'contract-events', 'stellar-atlas.full-history.contract-events.v3', 'application/vnd.apache.parquet', 'typed-projection'),
	(9, 'ledger-entry-changes', 'stellar-atlas.full-history.ledger-entry-changes.v2', 'application/vnd.apache.parquet', 'typed-projection'),
	(10, 'ledger-entry-changes', 'stellar-atlas.full-history.ledger-entry-changes.v3', 'application/vnd.apache.parquet', 'typed-projection'),
	(11, 'ledger-entry-changes', 'stellar-atlas.full-history.ledger-entry-changes.v4', 'application/vnd.apache.parquet', 'typed-projection'),
	(12, 'account-state-changes', 'stellar-atlas.full-history.account-state-changes.v1', 'application/vnd.apache.parquet', 'typed-projection'),
	(13, 'trustline-state-changes', 'stellar-atlas.full-history.trustline-state-changes.v1', 'application/vnd.apache.parquet', 'typed-projection'),
	(14, 'ledger-entry-changes', 'stellar-atlas.full-history.ledger-entry-changes.v4', 'application/json', 'typed-projection'),
	(15, 'ledger-entry-changes', 'stellar-atlas.full-history.ledger-entry-changes.v4', 'application/vnd.apache.parquet', 'lossless-replay'),
	(16, 'ledger-entry-changes', 'stellar-atlas.full-history.ledger-entry-changes.v999', 'application/vnd.apache.parquet', 'typed-projection'),
	(17, 'unknown-dataset', 'stellar-atlas.full-history.ledger-entry-changes.v4', 'application/vnd.apache.parquet', 'typed-projection')`;
const contractCaseCount = 17;
const maximumMetadataTextLength = 65_536;

/** Additional compact-only contract gate; ordinary schema readiness still applies. */
export async function assertFullHistoryLedgerEntryCompactSchemaReady(
	dataSource: DataSource
): Promise<void> {
	const metadata: unknown = await dataSource.query(metadataSql);
	if (!Array.isArray(metadata) || metadata.length !== 1) throw notReady();
	const row: unknown = metadata[0];
	if (!hasExactKeys(row, ['constraintExpression', 'datasetSetBody'])) {
		throw notReady();
	}
	const expression = row.constraintExpression;
	const body = row.datasetSetBody;
	if (!isBoundedText(expression) || !isBoundedText(body) ||
		normalizeBody(body) !== expectedAssertionBody()) {
		throw notReady();
	}
	assertLiteralPredicate(expression);
	const results: unknown = await dataSource.query(`
		with cases(case_id, dataset, schema_version, media_type, representation) as (
			${contractCasesSql}
		)
		select case_id as "caseId", (${expression}) as actual,
			(${fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql}) as expected
		from cases order by case_id`);
	if (!Array.isArray(results) || results.length !== contractCaseCount) {
		throw notReady();
	}
	for (let index = 0; index < contractCaseCount; index++) {
		const result: unknown = results[index];
		if (!hasExactKeys(result, ['caseId', 'actual', 'expected']) ||
			result.caseId !== index + 1 || typeof result.actual !== 'boolean' ||
			typeof result.expected !== 'boolean' || result.actual !== result.expected) {
			throw notReady();
		}
	}
}

function expectedAssertionBody(): string {
	const parts = enableFullHistoryLedgerCloseMetaCompactDatasetSetSql.split('$$');
	if (parts.length !== 3 || parts[1] === undefined) throw notReady();
	return normalizeBody(parts[1]);
}

function normalizeBody(value: string): string {
	return value.replace(/\r\n?/g, '\n').trim();
}

function isBoundedText(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 &&
		value.length <= maximumMetadataTextLength;
}

function hasExactKeys(
	value: unknown,
	keys: readonly string[]
): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key));
}

function assertLiteralPredicate(expression: string): void {
	// pg_get_expr is catalogue SQL, not user input, but must still not introduce
	// another relation, subquery or function call into this literals-only check.
	const columns = new Set(['dataset', 'schema_version', 'media_type', 'representation']);
	const keywords = new Set(['and', 'or', 'in', 'any', 'array', 'text', 'true', 'false']);
	const tokens = /\s+|'(?:[^']|'')*'|"[a-z_]+"|::\s*character\s+varying\b|::|[a-z_]+|[()[\],=]/giy;
	let offset = 0;
	while (offset < expression.length) {
		tokens.lastIndex = offset;
		const token = tokens.exec(expression)?.[0];
		if (token === undefined) throw notReady();
		offset = tokens.lastIndex;
		// PostgreSQL deparses varchar ARRAY elements with this two-word cast.
		if (/^::\s*character\s+varying$/i.test(token)) {
			if (/^\s*\(/.test(expression.slice(offset))) throw notReady();
			continue;
		}
		if (/^\s+$/.test(token) || token.startsWith("'") ||
			/^(?:::|[()[\],=])$/.test(token)) continue;
		if (/^\s*\(/.test(expression.slice(offset)) &&
			(token.startsWith('"') || columns.has(token) || token.toLowerCase() === 'text')) {
			throw notReady();
		}
		if (token.startsWith('"')) {
			if (!columns.has(token.slice(1, -1))) throw notReady();
		} else if (!columns.has(token) && !keywords.has(token.toLowerCase())) {
			throw notReady();
		}
	}
}

function notReady(): Error {
	return new Error('Compact ledger entry catalogue schema is not ready');
}
