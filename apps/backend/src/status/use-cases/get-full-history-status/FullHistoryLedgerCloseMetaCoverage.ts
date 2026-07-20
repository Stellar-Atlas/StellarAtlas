import type { DataSource } from 'typeorm';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	type FullHistoryLedgerCloseMetaDataset
} from '@history-scan-coordinator/domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';

export interface FullHistoryLedgerCloseMetaCoverageDTO {
	readonly batchCount: number;
	readonly firstAvailableLedger: string;
	readonly firstLedger: string | null;
	readonly lastLedger: string | null;
	readonly ledgerCount: string;
	readonly nextLedger: string;
	readonly outputs: readonly FullHistoryLedgerCloseMetaOutputCoverageDTO[];
	readonly sourceCount: number;
	readonly updatedAt: string;
}

export interface FullHistoryLedgerCloseMetaOutputCoverageDTO {
	readonly batchCount: number;
	readonly dataset: FullHistoryLedgerCloseMetaDataset;
	readonly outputBytes: string;
	readonly recordCount: string;
	readonly schemaVersions: readonly string[];
}

interface CoverageRow {
	readonly batchCount: number | string;
	readonly firstAvailableLedger: number | string;
	readonly firstLedger: number | string | null;
	readonly lastLedger: number | string | null;
	readonly ledgerCount: number | string;
	readonly nextLedger: number | string;
	readonly sourceCount: number | string;
	readonly updatedAt: Date | string;
}

interface OutputRow {
	readonly batchCount: number | string;
	readonly dataset: string;
	readonly outputBytes: number | string;
	readonly recordCount: number | string;
	readonly schemaVersions: string[];
}

const datasetNames = new Set<string>(FULL_HISTORY_LEDGER_CLOSE_META_DATASETS);

export async function readFullHistoryLedgerCloseMetaCoverage(
	dataSource: DataSource,
	networkPassphrase: string
): Promise<FullHistoryLedgerCloseMetaCoverageDTO | null> {
	const networkHash = hashNetworkPassphrase(networkPassphrase).toBuffer();
	const [coverageRows, outputRows] = await Promise.all([
		dataSource.query<CoverageRow[]>(coverageSql, [networkHash]),
		dataSource.query<OutputRow[]>(outputSql, [networkHash])
	]);
	const coverage = coverageRows[0];
	if (coverage === undefined) return null;
	return {
		batchCount: numberValue(coverage.batchCount),
		firstAvailableLedger: coverage.firstAvailableLedger.toString(),
		firstLedger: nullableString(coverage.firstLedger),
		lastLedger: nullableString(coverage.lastLedger),
		ledgerCount: coverage.ledgerCount.toString(),
		nextLedger: coverage.nextLedger.toString(),
		outputs: outputRows.map(mapOutput),
		sourceCount: numberValue(coverage.sourceCount),
		updatedAt: dateValue(coverage.updatedAt).toISOString()
	};
}

function mapOutput(
	row: OutputRow
): FullHistoryLedgerCloseMetaOutputCoverageDTO {
	if (!datasetNames.has(row.dataset)) {
		throw new TypeError(`Unknown LedgerCloseMeta dataset ${row.dataset}`);
	}
	return {
		batchCount: numberValue(row.batchCount),
		dataset: row.dataset as FullHistoryLedgerCloseMetaDataset,
		outputBytes: row.outputBytes.toString(),
		recordCount: row.recordCount.toString(),
		schemaVersions: Object.freeze([...row.schemaVersions])
	};
}

function numberValue(value: number | string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new TypeError('LedgerCloseMeta coverage count is invalid');
	}
	return parsed;
}

function nullableString(value: number | string | null): string | null {
	return value === null ? null : value.toString();
}

function dateValue(value: Date | string): Date {
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.valueOf())) {
		throw new TypeError('LedgerCloseMeta coverage timestamp is invalid');
	}
	return date;
}

const coverageSql = `
	select watermark."first_available_ledger"::text as "firstAvailableLedger",
		watermark."next_ledger"::text as "nextLedger",
		watermark."updated_at" as "updatedAt",
		count(batch.id)::integer as "batchCount",
		count(distinct batch."source_id")::integer as "sourceCount",
		coalesce(sum(batch."ledger_count"), 0)::text as "ledgerCount",
		min(batch."start_ledger")::text as "firstLedger",
		max(batch."end_ledger")::text as "lastLedger"
	from "full_history_ledger_close_meta_watermark" watermark
	left join "full_history_ledger_close_meta_batch" batch
		on batch."network_passphrase_hash" = watermark."network_passphrase_hash"
	where watermark."network_passphrase_hash" = $1
	group by watermark."network_passphrase_hash",
		watermark."first_available_ledger", watermark."next_ledger",
		watermark."updated_at"
`;

const outputSql = `
	select "dataset", sum("batch_count")::text as "batchCount",
		sum("record_count")::text as "recordCount",
		sum("output_bytes")::text as "outputBytes",
		array_agg(distinct "schema_version" order by "schema_version")
			as "schemaVersions"
	from "full_history_lcm_dataset_status_rollup"
	where "network_passphrase_hash" = $1
	group by "dataset"
	order by "dataset"
`;
