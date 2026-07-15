import { createHash } from 'node:crypto';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	type FullHistoryLedgerCloseMetaDataset
} from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';

export interface SourceFixture {
	readonly configDigest: Buffer;
	readonly id: string;
	readonly networkHash: Buffer;
}

export interface BatchFixture {
	readonly batchId: string;
	readonly endLedger: number;
	readonly firstPreviousLedgerHash?: Buffer;
	readonly misrepresent?: FullHistoryLedgerCloseMetaDataset;
	readonly seed: number;
	readonly sourceHashGapAt?: number;
	readonly startLedger: number;
}

export interface DatasetFixtureOptions {
	readonly misrepresent?: FullHistoryLedgerCloseMetaDataset;
	readonly skip?: FullHistoryLedgerCloseMetaDataset;
}

type CoreDataset =
	(typeof FULL_HISTORY_LEDGER_CLOSE_META_CORE_DATASETS)[number];

export const legacySchemaVersions = {
	...FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	'contract-events': 'stellar-atlas.full-history.contract-events.v2',
	'ledger-entry-changes': 'stellar-atlas.full-history.ledger-entry-changes.v2'
} satisfies Readonly<Record<CoreDataset, string>>;

export function ledgerHash(sequence: number): Buffer {
	return createHash('sha256').update(`fixture-ledger:${sequence}`).digest();
}
