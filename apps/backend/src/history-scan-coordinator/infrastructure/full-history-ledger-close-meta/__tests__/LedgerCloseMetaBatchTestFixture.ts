import { zstdCompressSync } from 'node:zlib';
import { xdr } from '@stellar/stellar-sdk';
import type { FullHistoryLedgerCloseMetaVersion } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

export interface LedgerCloseMetaBatchFixture {
	readonly compressed: Buffer;
	readonly xdrBytes: Buffer;
}

export function ledgerCloseMetaBatchFixture(
	startSequence: number,
	endSequence: number,
	ledgerSequences: readonly number[],
	versions: readonly FullHistoryLedgerCloseMetaVersion[] = ledgerSequences.map(
		() => 0 as const
	)
): LedgerCloseMetaBatchFixture {
	if (ledgerSequences.length !== versions.length) {
		throw new Error('Fixture sequences and versions must have equal lengths');
	}
	const batch = new xdr.LedgerCloseMetaBatch({
		endSequence,
		ledgerCloseMeta: ledgerSequences.map((sequence, index) =>
			ledgerCloseMeta(sequence, versions[index]!)
		),
		startSequence
	});
	const xdrBytes = batch.toXDR();
	return { compressed: zstdCompressSync(xdrBytes), xdrBytes };
}

function ledgerCloseMeta(
	sequence: number,
	version: FullHistoryLedgerCloseMetaVersion
): xdr.LedgerCloseMeta {
	if (version === 0) {
		return new xdr.LedgerCloseMeta(
			0,
			new xdr.LedgerCloseMetaV0({
				ledgerHeader: ledgerHeader(sequence),
				scpInfo: [],
				txProcessing: [],
				txSet: new xdr.TransactionSet({
					previousLedgerHash: hash(sequence - 1),
					txes: []
				}),
				upgradesProcessing: []
			})
		);
	}

	const generalizedTxSet = new xdr.GeneralizedTransactionSet(
		1,
		new xdr.TransactionSetV1({
			phases: [],
			previousLedgerHash: hash(sequence - 1)
		})
	);
	if (version === 1) {
		return new xdr.LedgerCloseMeta(
			1,
			new xdr.LedgerCloseMetaV1({
				evictedKeys: [],
				ext: new xdr.LedgerCloseMetaExt(0),
				ledgerHeader: ledgerHeader(sequence),
				scpInfo: [],
				totalByteSizeOfLiveSorobanState: xdr.Uint64.fromString('0'),
				txProcessing: [],
				txSet: generalizedTxSet,
				unused: [],
				upgradesProcessing: []
			})
		);
	}
	return new xdr.LedgerCloseMeta(
		2,
		new xdr.LedgerCloseMetaV2({
			evictedKeys: [],
			ext: new xdr.LedgerCloseMetaExt(0),
			ledgerHeader: ledgerHeader(sequence),
			scpInfo: [],
			totalByteSizeOfLiveSorobanState: xdr.Uint64.fromString('0'),
			txProcessing: [],
			txSet: generalizedTxSet,
			upgradesProcessing: []
		})
	);
}

function ledgerHeader(sequence: number): xdr.LedgerHeaderHistoryEntry {
	return new xdr.LedgerHeaderHistoryEntry({
		ext: new xdr.LedgerHeaderHistoryEntryExt(0),
		hash: hash(sequence),
		header: new xdr.LedgerHeader({
			baseFee: 100,
			baseReserve: 5_000_000,
			bucketListHash: hash(10),
			ext: new xdr.LedgerHeaderExt(0),
			feePool: xdr.Int64.fromString('0'),
			idPool: xdr.Uint64.fromString('0'),
			inflationSeq: 0,
			ledgerSeq: sequence,
			ledgerVersion: 22,
			maxTxSetSize: 1000,
			previousLedgerHash: hash(sequence - 1),
			scpValue: new xdr.StellarValue({
				closeTime: xdr.Uint64.fromString(sequence.toString()),
				ext: xdr.StellarValueExt.stellarValueBasic(),
				txSetHash: hash(8),
				upgrades: []
			}),
			skipList: [hash(0), hash(0), hash(0), hash(0)],
			totalCoins: xdr.Int64.fromString('0'),
			txSetResultHash: hash(9)
		})
	});
}

function hash(seed: number): Buffer {
	return Buffer.alloc(32, seed & 0xff);
}
