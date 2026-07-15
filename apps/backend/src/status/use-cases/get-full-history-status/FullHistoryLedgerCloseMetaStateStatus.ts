import type { DataSource } from 'typeorm';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import {
	FULL_HISTORY_STATE_DATASETS,
	type FullHistoryStateDataset
} from '@history-scan-coordinator/domain/full-history-state-import/FullHistoryStateExport.js';

export interface FullHistoryLedgerCloseMetaStateStatusDTO {
	readonly canonicalLinkage: FullHistoryCanonicalLinkageStatusDTO;
	readonly imports: FullHistoryStateImportStatusDTO;
}

export interface FullHistoryStateImportStatusDTO {
	readonly datasets: readonly FullHistoryStateImportDatasetStatusDTO[];
	readonly latestCompletedAt: string | null;
	readonly latestUpdatedAt: string | null;
	readonly lifecycle: FullHistoryStateImportLifecycleCountsDTO;
}

export interface FullHistoryStateImportDatasetStatusDTO {
	readonly dataset: FullHistoryStateDataset;
	readonly latestCompletedAt: string | null;
	readonly latestUpdatedAt: string | null;
	readonly lifecycle: FullHistoryStateImportLifecycleCountsDTO;
}

export interface FullHistoryStateImportLifecycleCountsDTO {
	readonly complete: number;
	readonly failed: number;
	readonly importing: number;
	readonly pending: number;
	readonly total: number;
}

export interface FullHistoryCanonicalLinkageStatusDTO {
	readonly expectedLedgerCount: string;
	readonly latestCompletedAt: string | null;
	readonly latestUpdatedAt: string | null;
	readonly lifecycle: FullHistoryCanonicalLinkageLifecycleCountsDTO;
	readonly matchedLedgerCount: string;
}

export interface FullHistoryCanonicalLinkageLifecycleCountsDTO {
	readonly checking: number;
	readonly complete: number;
	readonly failed: number;
	readonly pending: number;
	readonly total: number;
}

interface StateImportAggregateRow {
	readonly complete: unknown;
	readonly dataset: unknown;
	readonly failed: unknown;
	readonly importing: unknown;
	readonly latestCompletedAt: unknown;
	readonly latestUpdatedAt: unknown;
	readonly pending: unknown;
	readonly total: unknown;
}

interface CanonicalLinkageAggregateRow {
	readonly checking: unknown;
	readonly complete: unknown;
	readonly expectedLedgerCount: unknown;
	readonly failed: unknown;
	readonly latestCompletedAt: unknown;
	readonly latestUpdatedAt: unknown;
	readonly matchedLedgerCount: unknown;
	readonly pending: unknown;
	readonly total: unknown;
}

export async function readFullHistoryLedgerCloseMetaStateStatus(
	dataSource: DataSource,
	networkPassphrase: string
): Promise<FullHistoryLedgerCloseMetaStateStatusDTO> {
	const networkHash = hashNetworkPassphrase(networkPassphrase).toBuffer();
	const [stateImportRows, canonicalLinkageRows] = await Promise.all([
		dataSource.query<StateImportAggregateRow[]>(stateImportSql, [networkHash]),
		dataSource.query<CanonicalLinkageAggregateRow[]>(canonicalLinkageSql, [
			networkHash
		])
	]);
	return {
		canonicalLinkage: mapCanonicalLinkage(canonicalLinkageRows),
		imports: mapStateImports(stateImportRows)
	};
}

function mapStateImports(
	rows: readonly StateImportAggregateRow[]
): FullHistoryStateImportStatusDTO {
	const rowsByDataset = new Map<
		FullHistoryStateDataset,
		FullHistoryStateImportDatasetStatusDTO
	>();
	for (const row of rows) {
		const dataset = stateDataset(row.dataset);
		if (rowsByDataset.has(dataset)) {
			throw new TypeError(`Duplicate state import dataset ${dataset}`);
		}
		const lifecycle = mapStateImportLifecycle(row);
		const latestCompletedAt = nullableIsoTimestamp(
			row.latestCompletedAt,
			'state import completion'
		);
		const latestUpdatedAt = nullableIsoTimestamp(
			row.latestUpdatedAt,
			'state import update'
		);
		assertTimestampCoverage(
			lifecycle.total,
			lifecycle.complete,
			latestCompletedAt,
			latestUpdatedAt,
			'state import'
		);
		rowsByDataset.set(dataset, {
			dataset,
			latestCompletedAt,
			latestUpdatedAt,
			lifecycle
		});
	}
	const datasets = FULL_HISTORY_STATE_DATASETS.map(
		(dataset): FullHistoryStateImportDatasetStatusDTO =>
			rowsByDataset.get(dataset) ?? {
				dataset,
				latestCompletedAt: null,
				latestUpdatedAt: null,
				lifecycle: emptyStateImportLifecycle()
			}
	);
	return {
		datasets,
		latestCompletedAt: latestTimestamp(
			datasets.map((dataset) => dataset.latestCompletedAt)
		),
		latestUpdatedAt: latestTimestamp(
			datasets.map((dataset) => dataset.latestUpdatedAt)
		),
		lifecycle: sumStateImportLifecycles(
			datasets.map((dataset) => dataset.lifecycle)
		)
	};
}

function mapCanonicalLinkage(
	rows: readonly CanonicalLinkageAggregateRow[]
): FullHistoryCanonicalLinkageStatusDTO {
	if (rows.length > 1) {
		throw new TypeError('Canonical linkage aggregate returned multiple rows');
	}
	const row = rows[0];
	if (row === undefined) {
		return {
			expectedLedgerCount: '0',
			latestCompletedAt: null,
			latestUpdatedAt: null,
			lifecycle: emptyCanonicalLinkageLifecycle(),
			matchedLedgerCount: '0'
		};
	}
	const lifecycle = mapCanonicalLinkageLifecycle(row);
	const expectedLedgerCount = nonNegativeIntegerString(
		row.expectedLedgerCount,
		'canonical linkage expected ledger count'
	);
	const matchedLedgerCount = nonNegativeIntegerString(
		row.matchedLedgerCount,
		'canonical linkage matched ledger count'
	);
	if (BigInt(matchedLedgerCount) > BigInt(expectedLedgerCount)) {
		throw new TypeError('Canonical linkage matched ledger count is invalid');
	}
	if (
		lifecycle.total > 0 &&
		lifecycle.complete === lifecycle.total &&
		matchedLedgerCount !== expectedLedgerCount
	) {
		throw new TypeError('Completed canonical linkage is not fully matched');
	}
	const latestCompletedAt = nullableIsoTimestamp(
		row.latestCompletedAt,
		'canonical linkage completion'
	);
	const latestUpdatedAt = nullableIsoTimestamp(
		row.latestUpdatedAt,
		'canonical linkage update'
	);
	assertTimestampCoverage(
		lifecycle.total,
		lifecycle.complete,
		latestCompletedAt,
		latestUpdatedAt,
		'canonical linkage'
	);
	return {
		expectedLedgerCount,
		latestCompletedAt,
		latestUpdatedAt,
		lifecycle,
		matchedLedgerCount
	};
}

function mapStateImportLifecycle(
	row: StateImportAggregateRow
): FullHistoryStateImportLifecycleCountsDTO {
	const lifecycle = {
		complete: countValue(row.complete, 'state import complete count'),
		failed: countValue(row.failed, 'state import failed count'),
		importing: countValue(row.importing, 'state import importing count'),
		pending: countValue(row.pending, 'state import pending count'),
		total: countValue(row.total, 'state import total count')
	};
	assertLifecycleTotal(lifecycle, 'state import');
	return lifecycle;
}

function mapCanonicalLinkageLifecycle(
	row: CanonicalLinkageAggregateRow
): FullHistoryCanonicalLinkageLifecycleCountsDTO {
	const lifecycle = {
		checking: countValue(row.checking, 'canonical linkage checking count'),
		complete: countValue(row.complete, 'canonical linkage complete count'),
		failed: countValue(row.failed, 'canonical linkage failed count'),
		pending: countValue(row.pending, 'canonical linkage pending count'),
		total: countValue(row.total, 'canonical linkage total count')
	};
	assertLifecycleTotal(lifecycle, 'canonical linkage');
	return lifecycle;
}

function sumStateImportLifecycles(
	values: readonly FullHistoryStateImportLifecycleCountsDTO[]
): FullHistoryStateImportLifecycleCountsDTO {
	return values.reduce<FullHistoryStateImportLifecycleCountsDTO>(
		(total, value) => ({
			complete: safeSum(total.complete, value.complete, 'complete imports'),
			failed: safeSum(total.failed, value.failed, 'failed imports'),
			importing: safeSum(total.importing, value.importing, 'importing imports'),
			pending: safeSum(total.pending, value.pending, 'pending imports'),
			total: safeSum(total.total, value.total, 'total imports')
		}),
		emptyStateImportLifecycle()
	);
}

function emptyStateImportLifecycle(): FullHistoryStateImportLifecycleCountsDTO {
	return { complete: 0, failed: 0, importing: 0, pending: 0, total: 0 };
}

function emptyCanonicalLinkageLifecycle(): FullHistoryCanonicalLinkageLifecycleCountsDTO {
	return { checking: 0, complete: 0, failed: 0, pending: 0, total: 0 };
}

function stateDataset(value: unknown): FullHistoryStateDataset {
	if (
		typeof value !== 'string' ||
		!FULL_HISTORY_STATE_DATASETS.includes(value as FullHistoryStateDataset)
	) {
		throw new TypeError('Unknown state import dataset');
	}
	return value as FullHistoryStateDataset;
}

function countValue(value: unknown, label: string): number {
	const text = nonNegativeIntegerString(value, label);
	const count = Number(text);
	if (!Number.isSafeInteger(count)) throw new TypeError(`${label} is invalid`);
	return count;
}

function nonNegativeIntegerString(value: unknown, label: string): string {
	if (
		(typeof value !== 'string' && typeof value !== 'number') ||
		!/^(0|[1-9]\d*)$/u.test(value.toString())
	) {
		throw new TypeError(`${label} is invalid`);
	}
	if (typeof value === 'number' && !Number.isSafeInteger(value)) {
		throw new TypeError(`${label} is invalid`);
	}
	return BigInt(value).toString();
}

function assertLifecycleTotal(
	value:
		| FullHistoryStateImportLifecycleCountsDTO
		| FullHistoryCanonicalLinkageLifecycleCountsDTO,
	label: string
): void {
	const counts =
		'importing' in value
			? [value.pending, value.importing, value.complete, value.failed]
			: [value.pending, value.checking, value.complete, value.failed];
	const observed = counts.reduce(
		(total, count) => safeSum(total, count, `${label} lifecycle`),
		0
	);
	if (observed !== value.total) {
		throw new TypeError(`${label} lifecycle counts are incomplete`);
	}
}

function assertTimestampCoverage(
	total: number,
	complete: number,
	latestCompletedAt: string | null,
	latestUpdatedAt: string | null,
	label: string
): void {
	if (
		total > 0 !== (latestUpdatedAt !== null) ||
		complete > 0 !== (latestCompletedAt !== null)
	) {
		throw new TypeError(`${label} timestamps are incomplete`);
	}
}

function nullableIsoTimestamp(value: unknown, label: string): string | null {
	if (value === null) return null;
	if (typeof value !== 'string' && !(value instanceof Date)) {
		throw new TypeError(`${label} timestamp is invalid`);
	}
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.valueOf())) {
		throw new TypeError(`${label} timestamp is invalid`);
	}
	return date.toISOString();
}

function latestTimestamp(values: readonly (string | null)[]): string | null {
	let latest: string | null = null;
	for (const value of values) {
		if (value !== null && (latest === null || value > latest)) latest = value;
	}
	return latest;
}

function safeSum(left: number, right: number, label: string): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum))
		throw new TypeError(`${label} count is invalid`);
	return sum;
}

const stateImportSql = `
	select control."dataset",
		count(*)::text as "total",
		(count(*) filter (where control."status" = 'pending'))::text as "pending",
		(count(*) filter (where control."status" = 'importing'))::text as "importing",
		(count(*) filter (where control."status" = 'complete'))::text as "complete",
		(count(*) filter (where control."status" = 'failed'))::text as "failed",
		max(control."completed_at") as "latestCompletedAt",
		max(control."updated_at") as "latestUpdatedAt"
	from "full_history_lcm_state_import" control
	join "full_history_ledger_close_meta_batch" batch
		on batch."id" = control."batch_id"
	where batch."network_passphrase_hash" = $1
	group by control."dataset"
	order by control."dataset"
`;

const canonicalLinkageSql = `
	select count(*)::text as "total",
		(count(*) filter (where "status" = 'pending'))::text as "pending",
		(count(*) filter (where "status" = 'checking'))::text as "checking",
		(count(*) filter (where "status" = 'complete'))::text as "complete",
		(count(*) filter (where "status" = 'failed'))::text as "failed",
		coalesce(sum("expected_ledger_count"), 0)::text as "expectedLedgerCount",
		coalesce(sum("matched_ledger_count"), 0)::text as "matchedLedgerCount",
		max("completed_at") as "latestCompletedAt",
		max("updated_at") as "latestUpdatedAt"
	from "full_history_lcm_state_canonical_coverage"
	where "network_passphrase_hash" = $1
	group by "network_passphrase_hash"
`;
