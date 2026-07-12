import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { xdr } from '@stellar/stellar-sdk';
import { FullHistoryHash } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

export const publicNetworkPassphrase =
	'Public Global Stellar Network ; September 2015';

export interface RealTransactionFixture {
	readonly envelopeXdr: string;
	readonly ledgerSequence: number;
	readonly resultXdr: string;
	readonly transactionHash: FullHistoryHash;
	readonly transactionResultHash: FullHistoryHash;
	readonly transactionSetHash: FullHistoryHash;
}

export function emptyTransactionResultSetHash(): FullHistoryHash {
	return resultSetHash([]);
}

export function readClassicArchiveTransactionFixture(): RealTransactionFixture {
	const fixtureRoot = 'apps/history-scanner/src/domain/scanner/__fixtures__';
	const transactionEntry = xdr.TransactionHistoryEntry.fromXDR(
		firstXdrFrame(`${fixtureRoot}/transactions.xdr.gz`)
	);
	const resultEntry = xdr.TransactionHistoryResultEntry.fromXDR(
		firstXdrFrame(`${fixtureRoot}/results.xdr.gz`)
	);
	const envelopes = transactionEntry.txSet().txes();
	const resultPairs = resultEntry.txResultSet().results();
	if (
		envelopes.length !== 1 ||
		resultPairs.length !== 1 ||
		transactionEntry.ledgerSeq() !== resultEntry.ledgerSeq()
	) {
		throw new Error('Classic archive fixture no longer has one exact pair');
	}

	return {
		envelopeXdr: envelopes[0]!.toXDR().toString('base64'),
		ledgerSequence: transactionEntry.ledgerSeq(),
		resultXdr: resultPairs[0]!.result().toXDR().toString('base64'),
		transactionHash: FullHistoryHash.fromBytes(
			resultPairs[0]!.transactionHash()
		),
		transactionResultHash: sha256(resultEntry.txResultSet().toXDR()),
		transactionSetHash: sha256(
			Buffer.concat([
				transactionEntry.txSet().previousLedgerHash(),
				...envelopes.map((envelope) => envelope.toXDR())
			])
		)
	};
}

export function readFeeBumpEtlFixture(): RealTransactionFixture {
	const path =
		'external-reference/stellar-etl/testdata/transactions/ledger_fee_bump.golden';
	for (const line of readFileSync(path, 'utf8').split('\n')) {
		if (!line.includes('"tx_envelope":"AAAABQ')) continue;
		const row = readRecord(JSON.parse(line));
		const envelopeXdr = readString(row, 'tx_envelope');
		const ledgerSequence = readInteger(row, 'ledger_sequence');
		const resultXdr = readString(row, 'tx_result');
		const transactionHash = FullHistoryHash.fromHex(
			readString(row, 'transaction_hash')
		);
		return {
			envelopeXdr,
			ledgerSequence,
			resultXdr,
			transactionHash,
			transactionResultHash: resultSetHash([{ resultXdr, transactionHash }]),
			transactionSetHash: sha256(
				Buffer.from(`fee-bump-transactions:${ledgerSequence}`)
			)
		};
	}
	throw new Error('No fee-bump transaction exists in the stellar-etl fixture');
}

export function resultSetHash(
	rows: readonly {
		readonly resultXdr: string;
		readonly transactionHash: FullHistoryHash;
	}[]
): FullHistoryHash {
	return sha256(
		new xdr.TransactionResultSet({
			results: rows.map(
				(row) =>
					new xdr.TransactionResultPair({
						result: xdr.TransactionResult.fromXDR(row.resultXdr, 'base64'),
						transactionHash: row.transactionHash.toBuffer()
					})
			)
		}).toXDR()
	);
}

function firstXdrFrame(path: string): Buffer {
	const uncompressed = gunzipSync(readFileSync(path));
	if (uncompressed.length < 4)
		throw new Error('Archive fixture has no XDR frame');
	const encodedLength = Buffer.from(uncompressed.subarray(0, 4));
	encodedLength[0] &= 0x7f;
	const frameLength = encodedLength.readUInt32BE(0);
	if (frameLength < 1 || frameLength > uncompressed.length - 4) {
		throw new Error('Archive fixture has an invalid XDR frame length');
	}
	return uncompressed.subarray(4, 4 + frameLength);
}

function sha256(value: Uint8Array): FullHistoryHash {
	return FullHistoryHash.fromBytes(createHash('sha256').update(value).digest());
}

function readRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('stellar-etl fixture row is not an object');
	}
	return value as Record<string, unknown>;
}

function readString(row: Record<string, unknown>, field: string): string {
	const value = row[field];
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`stellar-etl fixture ${field} is not a string`);
	}
	return value;
}

function readInteger(row: Record<string, unknown>, field: string): number {
	const value = row[field];
	if (!Number.isSafeInteger(value)) {
		throw new Error(`stellar-etl fixture ${field} is not an integer`);
	}
	return value as number;
}
