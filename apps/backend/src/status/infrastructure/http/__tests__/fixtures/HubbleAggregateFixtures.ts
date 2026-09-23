import type {
	HubbleCatalog,
	HubbleDataset,
	HubbleQuery
} from '../../HubbleWarehouseContracts.js';
import { summarizeHubbleLedgerCoverage } from '../../HubbleLedgerCoverage.js';
export const dataset: HubbleDataset = {
	name: 'history_transactions',
	rowCount: '3',
	columns: [
		['kind', 'Nullable(String)'],
		['amount', 'Nullable(Int64)'],
		['ratio', 'Float64'],
		['_ledger_sequence', 'UInt32'],
		['_batch_id', 'String'],
		['_source_sha256', 'String']
	].map(([name, type], index) => ({
		name: name!,
		type: type!,
		position: index + 1
	}))
};
export const catalog: HubbleCatalog = {
	database: 'stellar_hubble',
	datasets: [dataset],
	generatedAt: '2026-09-07T00:00:00Z',
	officialSchemaSource: 'fixture',
	coverage: summarizeHubbleLedgerCoverage([
		{ start_ledger: 2, end_ledger: 100 }
	]),
	ingestion: {
		completedBatches: '1',
		failedBatches: '0',
		maximumLedger: '100',
		minimumLedger: '2',
		startedBatches: '0',
		totalRows: '3'
	}
};
export const input: HubbleQuery = {
	dataset: dataset.name,
	minLedger: 2,
	maxLedger: 100,
	groupBy: ['kind'],
	aggregations: [
		{ function: 'count', alias: 'n' },
		{ function: 'sum', field: 'amount', alias: 'total' }
	],
	orderBy: [{ field: 'total', direction: 'desc' }],
	limit: 2
};
export const records = `SELECT * FROM values('kind Nullable(String),amount Nullable(Int64),ratio Float64,_ledger_sequence UInt32,_batch_id String,_source_sha256 String',
 ('A',9223372036854775807,1.5,10,'good','s1'),('A',9007199254740993,2.5,11,'good','s1'),
 ('B',20,0.5,12,'good','s1'),('C',5,0.25,13,'good','s1'),
 (NULL,NULL,0,14,'good','s1'),
 ('A',999,99,15,'failed','s2'),('A',999,99,16,'good','wrong'),
 ('A',999,99,17,'retry','s3'),('A',999,99,200,'good','s1'))`;
export const batches = `SELECT * FROM values('batch_id String,source_sha256 String,status String,updated_at UInt32',
 ('good','s1','complete',10),('failed','s2','failed',10),
 ('retry','s3','complete',10),('retry','s3','started',20))`;
