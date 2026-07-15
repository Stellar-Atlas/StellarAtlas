import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE,
	FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	isValidFullHistoryLedgerCloseMetaOutputSet,
	type FullHistoryLedgerCloseMetaDataset,
	type FullHistoryLedgerCloseMetaDatasetOutput
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';

const range = fullHistoryLedgerCloseMetaRange(3, 66);

describe('full-history LedgerCloseMeta dataset schema contract', () => {
	it('accepts only coherent v6, v7, and v8 output sets', () => {
		expect(isValid(coreOutputs(legacySchemas))).toBe(true);
		expect(isValid(coreOutputs(completeSchemas))).toBe(true);
		expect(isValid(stateOutputs(completeSchemas))).toBe(true);
	});

	it('rejects mixed v2/v3 projection schemas', () => {
		expect(isValid(coreOutputs(mixedProjectionSchemas))).toBe(false);
	});

	it('rejects state projections paired with v2 projection schemas', () => {
		expect(isValid(stateOutputs(legacySchemas))).toBe(false);
	});
});

function isValid(outputs: readonly FullHistoryLedgerCloseMetaDatasetOutput[]) {
	return isValidFullHistoryLedgerCloseMetaOutputSet(range, outputs);
}

function coreOutputs(
	schemas: DatasetSchemaVersions
): readonly FullHistoryLedgerCloseMetaDatasetOutput[] {
	return outputSet(FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS, schemas);
}

function stateOutputs(
	schemas: DatasetSchemaVersions
): readonly FullHistoryLedgerCloseMetaDatasetOutput[] {
	return outputSet(FULL_HISTORY_LEDGER_CLOSE_META_DATASETS, schemas);
}

function outputSet(
	datasets: readonly FullHistoryLedgerCloseMetaDataset[],
	schemas: DatasetSchemaVersions
): readonly FullHistoryLedgerCloseMetaDatasetOutput[] {
	return datasets.map((dataset) => {
		const canonical = dataset === 'ledger-close-meta';
		return {
			byteCount: 64,
			dataset,
			mediaType: canonical
				? FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE
				: FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE,
			recordCount: recordCount(dataset),
			representation: canonical ? 'lossless-replay' : 'typed-projection',
			schemaVersion: schemas[dataset],
			sha256: fullHistoryLedgerCloseMetaSha256Digest('ab'.repeat(32)),
			storageKey: `processed/${dataset}.parquet`
		};
	});
}

function recordCount(dataset: FullHistoryLedgerCloseMetaDataset): number {
	if (dataset === 'ledger-close-meta' || dataset === 'ledgers') return 64;
	if (
		dataset === 'transactions' ||
		dataset === 'transaction-results' ||
		dataset === 'transaction-meta'
	) {
		return 4;
	}
	return 0;
}

type DatasetSchemaVersions = Readonly<
	Record<FullHistoryLedgerCloseMetaDataset, string>
>;

const completeSchemas: DatasetSchemaVersions =
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS;

const legacySchemas = {
	...completeSchemas,
	'contract-events': 'stellar-atlas.full-history.contract-events.v2',
	'ledger-entry-changes': 'stellar-atlas.full-history.ledger-entry-changes.v2'
} satisfies DatasetSchemaVersions;

const mixedProjectionSchemas = {
	...completeSchemas,
	'contract-events': 'stellar-atlas.full-history.contract-events.v2'
} satisfies DatasetSchemaVersions;
