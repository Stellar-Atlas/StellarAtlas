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
		ledgerCloseMetas: ledgerSequences.map((sequence, index) =>
			ledgerCloseMeta(sequence, versions[index]!)
		),
		startSequence
	});
	const xdrBytes = Buffer.from(batch.toXDR());
	return { compressed: zstdCompressSync(xdrBytes), xdrBytes };
}

function ledgerCloseMeta(
	sequence: number,
	version: FullHistoryLedgerCloseMetaVersion
): xdr.LedgerCloseMeta {
	if (version === 0) {
		return xdr.LedgerCloseMeta.v0(
			new xdr.LedgerCloseMetaV0({
				ledgerHeader: ledgerHeader(sequence),
				scpInfo: [],
				txProcessing: [],
				txSet: new xdr.TransactionSet({
					previousLedgerHash: hash(sequence - 1),
					txs: []
				}),
				upgradesProcessing: []
			})
		);
	}

	const generalizedTxSet = xdr.GeneralizedTransactionSet.v1TxSet(
		new xdr.TransactionSetV1({
			phases: [],
			previousLedgerHash: hash(sequence - 1)
		})
	);
	if (version === 1) {
		return xdr.LedgerCloseMeta.v1(
			new xdr.LedgerCloseMetaV1({
				evictedKeys: [],
				ext: xdr.LedgerCloseMetaExt.v0(),
				ledgerHeader: ledgerHeader(sequence),
				scpInfo: [],
				totalByteSizeOfLiveSorobanState: 0n,
				txProcessing: [],
				txSet: generalizedTxSet,
				unused: [],
				upgradesProcessing: []
			})
		);
	}
	return xdr.LedgerCloseMeta.v2(
		new xdr.LedgerCloseMetaV2({
			evictedKeys: [],
			ext: xdr.LedgerCloseMetaExt.v0(),
			ledgerHeader: ledgerHeader(sequence),
			scpInfo: [],
			totalByteSizeOfLiveSorobanState: 0n,
			txProcessing: [],
			txSet: generalizedTxSet,
			upgradesProcessing: []
		})
	);
}

function ledgerHeader(sequence: number): xdr.LedgerHeaderHistoryEntry {
	return new xdr.LedgerHeaderHistoryEntry({
		ext: xdr.LedgerHeaderHistoryEntryExt.v0(),
		hash: hash(sequence),
		header: new xdr.LedgerHeader({
			baseFee: 100,
			baseReserve: 5_000_000,
			bucketListHash: hash(10),
			ext: xdr.LedgerHeaderExt.v0(),
			feePool: 0n,
			idPool: 0n,
			inflationSeq: 0,
			ledgerSeq: sequence,
			ledgerVersion: 22,
			maxTxSetSize: 1000,
			previousLedgerHash: hash(sequence - 1),
			scpValue: new xdr.StellarValue({
				closeTime: BigInt(sequence),
				ext: xdr.StellarValueExt.stellarValueBasic(),
				txSetHash: hash(8),
				upgrades: []
			}),
			skipList: [hash(0), hash(0), hash(0), hash(0)],
			totalCoins: 0n,
			txSetResultHash: hash(9)
		})
	});
}

function hash(seed: number): Buffer {
	return Buffer.alloc(32, seed & 0xff);
}
