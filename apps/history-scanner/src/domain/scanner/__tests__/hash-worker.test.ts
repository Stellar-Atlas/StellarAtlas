import * as path from 'path';
import * as fs from 'fs';
import { gunzipSync } from 'zlib';
import { fileURLToPath } from 'node:url';
import { xdr } from '@stellar/stellar-sdk';
import {
	ArchiveXdrError,
	processLedgerHeaderHistoryEntryXDR,
	processScpHistoryEntryXDR,
	processTransactionHistoryEntryXDR,
	processTransactionHistoryResultEntryXDR
} from '../hash-worker.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(currentDir, '../__fixtures__');

it('should decode the true close time from a real ledger archive fixture', () => {
	const result = processLedgerHeaderHistoryEntryXDR(
		firstXdrFrame(path.join(fixturesDir, 'ledger.xdr.gz'))
	);

	expect(result).toMatchObject({
		closedAt: '2015-11-03T22:54:05.000Z',
		ledger: 556800
	});
});

it('rejects a ledger entry whose embedded hash does not match its header', () => {
	const frame = Buffer.from(
		firstXdrFrame(path.join(fixturesDir, 'ledger.xdr.gz'))
	);
	frame[0] ^= 0xff;

	expect(() => processLedgerHeaderHistoryEntryXDR(frame)).toThrow(
		'Ledger header history entry hash does not match its header XDR'
	);
});

it('should extract transaction envelope records from a real archive fixture', () => {
	const result = processTransactionHistoryEntryXDR(
		firstXdrFrame(path.join(fixturesDir, 'transactions.xdr.gz'))
	);

	expect(result).toMatchObject({
		hash: 'rx/vbqe2TibD5lhk3swAgQzeMud7rPtqZgKdangjWIA=',
		ledger: 556808
	});
	expect(result.envelopes).toHaveLength(1);
	expect(result.envelopes[0]).toEqual({
		envelopeXdr: expect.any(String),
		transactionIndex: 0
	});
});

it('should extract transaction result records from a real archive fixture', () => {
	const result = processTransactionHistoryResultEntryXDR(
		firstXdrFrame(path.join(fixturesDir, 'results.xdr.gz'))
	);

	expect(result).toMatchObject({
		hash: 'xd+H6dyxensZskf4Hhv7OQ8BB6HcdvKBQ7sgzySj6Ts=',
		ledger: 556808
	});
	expect(result.results).toHaveLength(1);
	expect(result.results[0]).toEqual({
		resultXdr: expect.any(String),
		transactionHash: expect.any(String),
		transactionIndex: 0
	});
});

it('preserves generalized-set hash and parallel-stage ordering across the SDK upgrade', () => {
	const envelope = xdr.TransactionHistoryEntry.fromXDR(
		firstXdrFrame(path.join(fixturesDir, 'transactions.xdr.gz'))
	).txSet.txs[0]!;
	const generalized = xdr.GeneralizedTransactionSet.v1TxSet(
		new xdr.TransactionSetV1({
			previousLedgerHash: Buffer.alloc(32, 7),
			phases: [
				xdr.TransactionPhase.v0Components([
					xdr.TxSetComponent.txsetCompTxsMaybeDiscountedFee(
						new xdr.TxSetComponentTxsMaybeDiscountedFee({
							baseFee: null,
							txs: [envelope]
						})
					)
				]),
				xdr.TransactionPhase.parallelTxsComponent(
					new xdr.ParallelTxsComponent({
						baseFee: 100n,
						executionStages: [[[envelope], [envelope]]]
					})
				)
			]
		})
	);
	const entry = new xdr.TransactionHistoryEntry({
		ledgerSeq: 60_000_000,
		txSet: new xdr.TransactionSet({
			previousLedgerHash: Buffer.alloc(32),
			txs: []
		}),
		ext: xdr.TransactionHistoryEntryExt.generalizedTxSet(generalized)
	});
	const result = processTransactionHistoryEntryXDR(entry.toXDR());
	// This digest was independently computed with SDK 16.2.0 from the same fixture.
	expect(result.hash).toBe('keWIq3khB8PTS3Lf4bRkd3N/w8+Vh5yx8JJxGfLtB3c=');
	expect(result.ledger).toBe(60_000_000);
	expect(result.envelopes).toEqual(
		[0, 1, 2].map((transactionIndex) => ({
			envelopeXdr: envelope.toXDR('base64'),
			transactionIndex
		}))
	);
});

it.each([
	['ledger', processLedgerHeaderHistoryEntryXDR],
	['transactions', processTransactionHistoryEntryXDR],
	['results', processTransactionHistoryResultEntryXDR],
	['scp', processScpHistoryEntryXDR]
] as const)(
	'should identify malformed %s XDR as remote archive content',
	(_category, process) => {
		expect(() => process(Buffer.from('not-xdr'))).toThrow(ArchiveXdrError);
		try {
			process(Buffer.from('not-xdr'));
		} catch (error) {
			expect(error).toMatchObject({ name: 'ArchiveXdrError' });
		}
	}
);

function firstXdrFrame(filePath: string): Buffer {
	const unzipped = gunzipSync(fs.readFileSync(filePath));
	const length = Buffer.from(unzipped.subarray(0, 4));
	length[0] &= 0x7f;
	const frameLength = length.readUInt32BE(0);
	return unzipped.subarray(4, 4 + frameLength);
}
