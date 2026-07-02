import * as workerpool from 'workerpool';
import { gunzip } from 'zlib';
import { createHash } from 'crypto';
import { isMainThread } from 'worker_threads';
import { hash, xdr } from '@stellar/stellar-sdk';

async function unzipAndHash(zip: ArrayBuffer): Promise<string> {
	return new Promise((resolve, reject) => {
		gunzip(zip, (error, unzipped) => {
			if (error) reject(error);
			else {
				const hashSum = createHash('sha256');
				hashSum.update(unzipped);
				resolve(hashSum.digest('hex'));
			}
		});
	});
}

export interface LedgerHeaderHistoryEntryResult {
	ledger: number;
	transactionsHash: string;
	transactionResultsHash: string;
	previousLedgerHeaderHash: string;
	ledgerHeaderHash: string;
	bucketListHash: string;
	protocolVersion: number;
}

export function processLedgerHeaderHistoryEntryXDR(
	ledgerHeaderHistoryEntryXDR: Buffer | Uint8Array
): LedgerHeaderHistoryEntryResult {
	const ledgerHeaderHistoryEntry = xdr.LedgerHeaderHistoryEntry.fromXDR(
		Buffer.from(ledgerHeaderHistoryEntryXDR)
	);
	return {
		ledger: ledgerHeaderHistoryEntry.header().ledgerSeq(),
		transactionResultsHash: ledgerHeaderHistoryEntry
			.header()
			.txSetResultHash()
			.toString('base64'),
		transactionsHash: ledgerHeaderHistoryEntry
			.header()
			.scpValue()
			.txSetHash()
			.toString('base64'),
		previousLedgerHeaderHash: ledgerHeaderHistoryEntry
			.header()
			.previousLedgerHash()
			.toString('base64'),
		ledgerHeaderHash: ledgerHeaderHistoryEntry.hash().toString('base64'),
		bucketListHash: ledgerHeaderHistoryEntry
			.header()
			.bucketListHash()
			.toString('base64'),
		protocolVersion: ledgerHeaderHistoryEntry.header().ledgerVersion()
	};
}

export function processTransactionHistoryResultEntryXDR(
	transactionHistoryResultXDR: Buffer | Uint8Array
): { ledger: number; hash: string } {
	const transactionHistoryResultEntry =
		xdr.TransactionHistoryResultEntry.fromXDR(
			Buffer.from(transactionHistoryResultXDR)
		);
	const resultSetHash = hash(
		transactionHistoryResultEntry.txResultSet().toXDR()
	);
	return {
		ledger: transactionHistoryResultEntry.ledgerSeq(),
		hash: resultSetHash.toString('base64')
	};
}

export function processTransactionHistoryEntryXDR(
	transactionHistoryEntryXDR: Uint8Array
): { ledger: number; hash: string } {
	const transactionHistoryEntry = xdr.TransactionHistoryEntry.fromXDR(
		Buffer.from(transactionHistoryEntryXDR)
	);
	const transactionSet =
		transactionHistoryEntry.ext().switch() === 1
			? transactionHistoryEntry.ext().generalizedTxSet()
			: transactionHistoryEntry.txSet();
	const transactionSetHash = hash(transactionSet.toXDR());
	return {
		ledger: transactionHistoryEntry.ledgerSeq(),
		hash: transactionSetHash.toString('base64')
	};
}

//weird behaviour, di loads this worker file without referencing it
if (!isMainThread) {
	workerpool.worker({
		unzipAndHash: unzipAndHash,
		processTransactionHistoryResultEntryXDR:
			processTransactionHistoryResultEntryXDR,
		processTransactionHistoryEntryXDR: processTransactionHistoryEntryXDR,
		processLedgerHeaderHistoryEntryXDR: processLedgerHeaderHistoryEntryXDR
	});
}
