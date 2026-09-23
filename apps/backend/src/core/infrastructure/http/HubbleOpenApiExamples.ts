import type { HubbleLedgerCoverage } from '../../../status/infrastructure/http/HubbleLedgerCoverage.js';
import type { HubbleCatalog } from '../../../status/infrastructure/http/HubbleWarehouseContracts.js';
import { explorerRecordExamples } from './HubbleExplorerOpenApiExamples.js';

// Representative, fixed documentation fixtures. These are not live ingestion totals,
// current balances, or evidence that every displayed historical interval is available.
export const hubbleExampleDescription =
	'Representative response shape and values, not a current coverage or availability report.';
export const hubbleCoverageExample = {
	completedRanges: [
		{ firstLedger: '2', lastLedger: '63489999' },
		{ firstLedger: '63490304', lastLedger: '63490367' }
	],
	contiguousFirstLedger: '2',
	contiguousLastLedger: '63489999',
	contiguousLedgerCount: '63489998',
	supplementalLedgerCount: '64',
	totalLedgerCount: '63490062',
	nextLedger: '63490000',
	minimumLedger: '2',
	maximumLedger: '63490367',
	gapCount: 1
} satisfies HubbleLedgerCoverage;
export const hubbleIngestionExample = {
	completedBatches: '62002',
	failedBatches: '0',
	startedBatches: '1',
	minimumLedger: '2',
	maximumLedger: '63490367',
	totalRows: '125000000'
} satisfies HubbleCatalog['ingestion'];
export const hubbleDatasetDetailExample = {
	database: 'stellar_hubble',
	// One representative column keeps the example short; the endpoint returns
	// every live column for the selected dataset.
	dataset: {
		columns: [{ name: 'transaction_hash', position: 1, type: 'String' }],
		name: 'history_transactions',
		rowCount: '25000000'
	},
	generatedAt: '2026-07-15T16:44:00.000Z',
	ingestion: hubbleIngestionExample,
	officialSchemaSource: 'stellar/stellar-etl'
};
export const hubbleCatalogExample = {
	database: hubbleDatasetDetailExample.database,
	coverage: hubbleCoverageExample,
	datasets: [hubbleDatasetDetailExample.dataset],
	generatedAt: hubbleDatasetDetailExample.generatedAt,
	ingestion: hubbleIngestionExample,
	officialSchemaSource: hubbleDatasetDetailExample.officialSchemaSource
};
export const hubbleQueryBodyExample = {
	dataset: 'history_transactions',
	select: ['transaction_hash', 'ledger_sequence', 'account', 'successful'],
	filters: [{ field: 'ledger_sequence', operator: 'eq', value: 63490364 }],
	orderBy: [{ field: 'id', direction: 'asc' }],
	limit: 10,
	offset: 0
};
export const hubbleQueryResultExample = {
	columns: hubbleQueryBodyExample.select,
	dataset: hubbleQueryBodyExample.dataset,
	elapsedMilliseconds: 12.5,
	limit: 10,
	offset: 0,
	rows: [
		{
			transaction_hash: explorerRecordExamples.operation.transactionHash,
			ledger_sequence: 63490364,
			account: explorerRecordExamples.operation.sourceAccount,
			successful: true
		}
	]
};
export const hubbleLedgerExample = {
	sequence: 63490364,
	ledger_hash: '1'.repeat(64),
	previous_ledger_hash: '2'.repeat(64),
	closed_at: '2026-07-15 16:43:50',
	transaction_count: 2,
	operation_count: 3
};
