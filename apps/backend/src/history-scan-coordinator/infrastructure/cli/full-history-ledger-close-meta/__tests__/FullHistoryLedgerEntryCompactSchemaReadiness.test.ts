import type { DataSource } from 'typeorm';
import {
	enableFullHistoryLedgerCloseMetaCompactDatasetSetSql,
	enableFullHistoryLedgerCloseMetaStateDatasetSetSql,
	fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql,
	fullHistoryLedgerCloseMetaStateProjectionDatasetContractPredicateSql
} from '../../../database/migrations/FullHistoryLedgerCloseMetaDatasetSchemaSql.js';
import { assertFullHistoryLedgerEntryCompactSchemaReady } from '../FullHistoryLedgerEntryCompactSchemaReadiness.js';

describe('compact ledger entry catalogue readiness', () => {
	it('accepts the exact compact assertion and evaluates only literal contract cases', async () => {
		const { dataSource, query } = mockDataSource();
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.resolves.toBeUndefined();
		expect(query).toHaveBeenCalledTimes(2);
		const metadata = query.mock.calls[0]?.[0];
		expect(metadata).toContain('pg_get_expr(contract.conbin, contract.conrelid)');
		expect(metadata).toContain("contract.contype = 'c'");
		expect(metadata).toContain("contract.conname = 'chk_full_history_lcm_dataset_contract'");
		expect(metadata).toContain("relation.relname = 'full_history_ledger_close_meta_dataset'");
		expect(metadata).toContain('namespace.nspname = current_schema()');
		expect(metadata).toContain('assert_full_history_lcm_batch_dataset_set(uuid)');
		const literals = query.mock.calls[1]?.[0];
		expect(literals).toContain(fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql);
		expect(literals).toContain('values');
		expect(literals).toContain('from cases order by case_id');
		expect(literals).not.toContain('from "full_history_ledger_close_meta_dataset"');
		expect(literals).not.toMatch(/\b(?:alter|insert|update|delete|create|drop)\s/i);
	});

	it('normalizes only line endings and outer whitespace of the exact body', async () => {
		const { dataSource } = mockDataSource({
			body: '\r\n' + assertionBody().replaceAll('\n', '\r\n') + '\r\n'
		});
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.resolves.toBeUndefined();
	});

	it('accepts PostgreSQL ANY/ARRAY and text-cast predicate spelling', async () => {
		const expression = fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql
			.replace(/"schema_version" in \(([^)]+)\)/g, '"schema_version" = ANY (ARRAY[$1])')
			.replace(/('(?:[^']|'')*')/g, '$1::text');
		const { dataSource } = mockDataSource({ expression });
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.resolves.toBeUndefined();
	});

	it('rejects the legacy function before evaluating any expression', async () => {
		const { dataSource, query } = mockDataSource({
			body: assertionBody(enableFullHistoryLedgerCloseMetaStateDatasetSetSql)
		});
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.rejects.toThrow('schema is not ready');
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('does not remove meaningful internal function whitespace when comparing', async () => {
		const { dataSource } = mockDataSource({
			body: assertionBody().replace('batch_ledgers integer;', 'batch_ledgers  integer;')
		});
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.rejects.toThrow('schema is not ready');
	});

	it.each([
		{ label: 'missing record', value: [] },
		{ label: 'duplicate records', value: [metadataRow(), metadataRow()] },
		{ label: 'null expression', value: [{ constraintExpression: null, datasetSetBody: assertionBody() }] },
		{ label: 'missing function', value: [{ ...metadataRow(), datasetSetBody: null }] },
		{ label: 'extra column', value: [{ ...metadataRow(), extra: true }] },
		{ label: 'non-array result', value: null }
	])('rejects $label metadata', async ({ value }) => {
		const { dataSource, query } = mockDataSource({ metadata: value });
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.rejects.toThrow('schema is not ready');
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('rejects a legacy CHECK that excludes the compact v4 case', async () => {
		const rows = verdicts();
		rows[10] = { caseId: 11, actual: false, expected: true };
		const { dataSource } = mockDataSource({
			expression: fullHistoryLedgerCloseMetaStateProjectionDatasetContractPredicateSql,
			results: rows
		});
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.rejects.toThrow('schema is not ready');
	});

	it.each([14, 15, 16, 17])('rejects a CHECK accepting invalid compact case %i', async (caseId) => {
		const rows = verdicts();
		rows[caseId - 1] = { caseId, actual: true, expected: false };
		const { dataSource } = mockDataSource({ results: rows });
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.rejects.toThrow('schema is not ready');
	});

	it.each([
		{ label: 'empty', value: [] },
		{ label: 'incomplete', value: [{ caseId: 1, actual: true, expected: true }] },
		{ label: 'non-array', value: null },
		{ label: 'null verdict', value: verdicts().map((row) => ({ ...row, actual: null })) },
		{ label: 'non-numeric ID', value: verdicts().map((row) => ({ ...row, caseId: String(row.caseId) })) },
		{ label: 'extra column', value: verdicts().map((row) => ({ ...row, extra: true })) }
	])(
		'rejects $label literal results', async ({ value }) => {
			const { dataSource } = mockDataSource({ results: value });
			await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
				.rejects.toThrow('schema is not ready');
		}
	);

	it.each(['pg_sleep(1) is null', "dataset('x') = 'x'", "\"dataset\"('x') = 'x'",
		"text('x') = 'x'", "(select dataset from archive) = 'x'"])(
		'rejects relation references and function calls in CHECK drift: %s', async (expression) => {
			const { dataSource, query } = mockDataSource({ expression });
			await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
				.rejects.toThrow('schema is not ready');
			expect(query).toHaveBeenCalledTimes(1);
		}
	);

	it('propagates a failed read instead of treating it as ready', async () => {
		const { dataSource, query } = mockDataSource();
		query.mockRejectedValueOnce(new Error('metadata unavailable'));
		await expect(assertFullHistoryLedgerEntryCompactSchemaReady(dataSource))
			.rejects.toThrow('metadata unavailable');
	});
});

function assertionBody(sql = enableFullHistoryLedgerCloseMetaCompactDatasetSetSql): string {
	const body = sql.split('$$')[1];
	if (body === undefined) throw new Error('Fixture has no assertion body');
	return body;
}

function metadataRow() {
	return {
		constraintExpression: fullHistoryLedgerCloseMetaCompactDatasetContractPredicateSql,
		datasetSetBody: assertionBody()
	};
}

function verdicts() {
	return Array.from({ length: 17 }, (_, index) => ({
		caseId: index + 1,
		actual: index < 13,
		expected: index < 13
	}));
}

function mockDataSource(options: {
	readonly body?: string;
	readonly expression?: string;
	readonly metadata?: unknown;
	readonly results?: unknown;
} = {}) {
	const metadata = Object.hasOwn(options, 'metadata') ? options.metadata : [{
		constraintExpression: options.expression ?? metadataRow().constraintExpression,
		datasetSetBody: options.body ?? assertionBody()
	}];
	const results = Object.hasOwn(options, 'results') ? options.results : verdicts();
	const query = jest.fn(async (_sql: string): Promise<unknown> => undefined)
		.mockResolvedValueOnce(metadata)
		.mockResolvedValueOnce(results);
	return { dataSource: { query } as unknown as DataSource, query };
}
