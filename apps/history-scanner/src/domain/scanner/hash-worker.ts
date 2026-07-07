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

export interface TransactionEnvelopeHistoryEntryResult {
	readonly ledger: number;
	readonly hash: string;
	readonly envelopes: readonly ParsedTransactionEnvelope[];
}

export interface TransactionResultHistoryEntryResult {
	readonly ledger: number;
	readonly hash: string;
	readonly results: readonly ParsedTransactionResult[];
}

export interface ParsedTransactionEnvelope {
	readonly envelopeXdr: string;
	readonly transactionIndex: number;
}

export interface ParsedTransactionResult {
	readonly resultXdr: string;
	readonly transactionHash: string;
	readonly transactionIndex: number;
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
): TransactionResultHistoryEntryResult {
	const transactionHistoryResultEntry =
		xdr.TransactionHistoryResultEntry.fromXDR(
			Buffer.from(transactionHistoryResultXDR)
		);
	const resultSetHash = hash(
		transactionHistoryResultEntry.txResultSet().toXDR()
	);
	return {
		ledger: transactionHistoryResultEntry.ledgerSeq(),
		hash: resultSetHash.toString('base64'),
		results: transactionHistoryResultEntry
			.txResultSet()
			.results()
			.map((pair, transactionIndex) => ({
				resultXdr: pair.result().toXDR().toString('base64'),
				transactionHash: pair.transactionHash().toString('base64'),
				transactionIndex
			}))
	};
}

export function processTransactionHistoryEntryXDR(
	transactionHistoryEntryXDR: Uint8Array
): TransactionEnvelopeHistoryEntryResult {
	const transactionHistoryEntry = xdr.TransactionHistoryEntry.fromXDR(
		Buffer.from(transactionHistoryEntryXDR)
	);
	const transactionSetHash = hashTransactionHistoryEntry(
		transactionHistoryEntry
	);
	return {
		ledger: transactionHistoryEntry.ledgerSeq(),
		hash: transactionSetHash.toString('base64'),
		envelopes: extractTransactionEnvelopes(transactionHistoryEntry).map(
			(envelope, transactionIndex) => ({
				envelopeXdr: envelope.toXDR().toString('base64'),
				transactionIndex
			})
		)
	};
}

export function processScpHistoryEntryXDR(
	scpHistoryEntryXDR: Uint8Array
): void {
	xdr.ScpHistoryEntry.fromXDR(Buffer.from(scpHistoryEntryXDR));
}

function hashTransactionHistoryEntry(
	transactionHistoryEntry: xdr.TransactionHistoryEntry
): Buffer {
	if (transactionHistoryEntry.ext().switch() === 1) {
		return hash(transactionHistoryEntry.ext().generalizedTxSet().toXDR());
	}

	const transactionSet = transactionHistoryEntry.txSet();
	return hash(
		Buffer.concat([
			transactionSet.previousLedgerHash(),
			...transactionSet.txes().map((transaction) => transaction.toXDR())
		])
	);
}

function extractTransactionEnvelopes(
	transactionHistoryEntry: xdr.TransactionHistoryEntry
): readonly xdr.TransactionEnvelope[] {
	if (toSwitchNumber(transactionHistoryEntry.ext().switch()) === 1) {
		return extractGeneralizedTransactionEnvelopes(
			transactionHistoryEntry.ext().generalizedTxSet()
		);
	}

	return transactionHistoryEntry.txSet().txes();
}

function extractGeneralizedTransactionEnvelopes(
	generalizedTxSet: xdr.GeneralizedTransactionSet
): readonly xdr.TransactionEnvelope[] {
	const envelopes: xdr.TransactionEnvelope[] = [];
	for (const phase of generalizedTxSet.v1TxSet().phases()) {
		envelopes.push(...extractPhaseTransactionEnvelopes(phase));
	}
	return envelopes;
}

function extractPhaseTransactionEnvelopes(
	phase: xdr.TransactionPhase
): readonly xdr.TransactionEnvelope[] {
	const switchValue = toSwitchNumber(phase.switch());
	if (switchValue === 0) {
		return phase
			.v0Components()
			.flatMap((component) => extractComponentTransactionEnvelopes(component));
	}

	if (switchValue === 1) {
		return phase
			.parallelTxsComponent()
			.executionStages()
			.flatMap((stage) => stage.flatMap((batch) => batch));
	}

	throw new Error(`Unsupported transaction phase switch ${switchValue}`);
}

function extractComponentTransactionEnvelopes(
	component: xdr.TxSetComponent
): readonly xdr.TransactionEnvelope[] {
	const switchValue = toSwitchNumber(component.switch());
	if (switchValue !== 0) {
		throw new Error(`Unsupported transaction component switch ${switchValue}`);
	}

	return component.txsMaybeDiscountedFee().txes();
}

function toSwitchNumber(value: unknown): number {
	if (typeof value === 'number') return value;
	if (
		typeof value === 'object' &&
		value !== null &&
		'value' in value &&
		typeof value.value === 'number'
	) {
		return value.value;
	}

	throw new Error(`Unsupported XDR switch value ${String(value)}`);
}

//weird behaviour, di loads this worker file without referencing it
if (!isMainThread) {
	workerpool.worker({
		unzipAndHash: unzipAndHash,
		processTransactionHistoryResultEntryXDR:
			processTransactionHistoryResultEntryXDR,
		processTransactionHistoryEntryXDR: processTransactionHistoryEntryXDR,
		processScpHistoryEntryXDR: processScpHistoryEntryXDR,
		processLedgerHeaderHistoryEntryXDR: processLedgerHeaderHistoryEntryXDR
	});
}
