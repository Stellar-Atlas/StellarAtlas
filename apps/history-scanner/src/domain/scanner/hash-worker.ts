import * as workerpool from 'workerpool';
import { gunzip } from 'zlib';
import { createHash } from 'crypto';
import { isMainThread } from 'worker_threads';
import { hash, xdr } from '@stellar/stellar-sdk';

const archiveXdrErrorName = 'ArchiveXdrError';

export class ArchiveXdrError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = archiveXdrErrorName;
	}
}

export function isArchiveXdrError(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'name' in error &&
		error.name === archiveXdrErrorName
	);
}

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
	closedAt: string;
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
	const ledgerHeaderHistoryEntry = decodeArchiveXdr('ledger header', () =>
		xdr.LedgerHeaderHistoryEntry.fromXDR(
			Buffer.from(ledgerHeaderHistoryEntryXDR)
		)
	);
	const header = ledgerHeaderHistoryEntry.header;
	const computedLedgerHeaderHash = Buffer.from(hash(header.toXDR()));
	if (
		!computedLedgerHeaderHash.equals(ledgerHeaderHistoryEntry.hash.toBytes())
	) {
		throw new ArchiveXdrError(
			'Ledger header history entry hash does not match its header XDR'
		);
	}
	return {
		closedAt: closeTimeToIso(header.scpValue.closeTime),
		ledger: header.ledgerSeq,
		transactionResultsHash: Buffer.from(
			header.txSetResultHash.toBytes()
		).toString('base64'),
		transactionsHash: Buffer.from(header.scpValue.txSetHash.toBytes()).toString(
			'base64'
		),
		previousLedgerHeaderHash: Buffer.from(
			header.previousLedgerHash.toBytes()
		).toString('base64'),
		ledgerHeaderHash: computedLedgerHeaderHash.toString('base64'),
		bucketListHash: Buffer.from(header.bucketListHash.toBytes()).toString(
			'base64'
		),
		protocolVersion: header.ledgerVersion
	};
}

function closeTimeToIso(closeTime: { toString(): string }): string {
	const serialized = closeTime.toString();
	if (!/^\d+$/.test(serialized)) {
		throw new ArchiveXdrError(`Invalid ledger close time ${serialized}`);
	}

	const seconds = BigInt(serialized);
	const maximumDateSeconds = 8_640_000_000_000n;
	if (seconds > maximumDateSeconds) {
		throw new ArchiveXdrError(
			'Ledger close time is outside the JavaScript date range'
		);
	}

	return new Date(Number(seconds * 1000n)).toISOString();
}

export function processTransactionHistoryResultEntryXDR(
	transactionHistoryResultXDR: Buffer | Uint8Array
): TransactionResultHistoryEntryResult {
	const transactionHistoryResultEntry = decodeArchiveXdr(
		'transaction result',
		() =>
			xdr.TransactionHistoryResultEntry.fromXDR(
				Buffer.from(transactionHistoryResultXDR)
			)
	);
	const resultSetHash = hash(transactionHistoryResultEntry.txResultSet.toXDR());
	return {
		ledger: transactionHistoryResultEntry.ledgerSeq,
		hash: Buffer.from(resultSetHash).toString('base64'),
		results: transactionHistoryResultEntry.txResultSet.results.map(
			(pair, transactionIndex) => ({
				resultXdr: pair.result.toXDR('base64'),
				transactionHash: Buffer.from(pair.transactionHash.toBytes()).toString(
					'base64'
				),
				transactionIndex
			})
		)
	};
}

export function processTransactionHistoryEntryXDR(
	transactionHistoryEntryXDR: Uint8Array
): TransactionEnvelopeHistoryEntryResult {
	const transactionHistoryEntry = decodeArchiveXdr('transaction envelope', () =>
		xdr.TransactionHistoryEntry.fromXDR(Buffer.from(transactionHistoryEntryXDR))
	);
	const transactionSetHash = hashTransactionHistoryEntry(
		transactionHistoryEntry
	);
	return {
		ledger: transactionHistoryEntry.ledgerSeq,
		hash: transactionSetHash.toString('base64'),
		envelopes: extractTransactionEnvelopes(transactionHistoryEntry).map(
			(envelope, transactionIndex) => ({
				envelopeXdr: envelope.toXDR('base64'),
				transactionIndex
			})
		)
	};
}

export function processScpHistoryEntryXDR(
	scpHistoryEntryXDR: Uint8Array
): void {
	decodeArchiveXdr('SCP history', () =>
		xdr.ScpHistoryEntry.fromXDR(Buffer.from(scpHistoryEntryXDR))
	);
}

function decodeArchiveXdr<Result>(label: string, decode: () => Result): Result {
	try {
		return decode();
	} catch (error) {
		if (isArchiveXdrError(error)) throw error;
		throw new ArchiveXdrError(`Invalid ${label} archive XDR`, { cause: error });
	}
}

function hashTransactionHistoryEntry(
	transactionHistoryEntry: xdr.TransactionHistoryEntry
): Buffer {
	if (transactionHistoryEntry.ext.type === 'generalizedTxSet') {
		return Buffer.from(
			hash(transactionHistoryEntry.ext.generalizedTxSet.toXDR())
		);
	}

	const transactionSet = transactionHistoryEntry.txSet;
	return Buffer.from(
		hash(
			Buffer.concat([
				transactionSet.previousLedgerHash.toBytes(),
				...transactionSet.txs.map((transaction) => transaction.toXDR())
			])
		)
	);
}

function extractTransactionEnvelopes(
	transactionHistoryEntry: xdr.TransactionHistoryEntry
): readonly xdr.TransactionEnvelope[] {
	if (transactionHistoryEntry.ext.type === 'generalizedTxSet') {
		return extractGeneralizedTransactionEnvelopes(
			transactionHistoryEntry.ext.generalizedTxSet
		);
	}

	return transactionHistoryEntry.txSet.txs;
}

function extractGeneralizedTransactionEnvelopes(
	generalizedTxSet: xdr.GeneralizedTransactionSet
): readonly xdr.TransactionEnvelope[] {
	const envelopes: xdr.TransactionEnvelope[] = [];
	for (const phase of generalizedTxSet.v1TxSet.phases) {
		envelopes.push(...extractPhaseTransactionEnvelopes(phase));
	}
	return envelopes;
}

function extractPhaseTransactionEnvelopes(
	phase: xdr.TransactionPhase
): readonly xdr.TransactionEnvelope[] {
	if (phase.type === 'v0Components') {
		return phase.v0Components.flatMap((component) =>
			extractComponentTransactionEnvelopes(component)
		);
	}

	if (phase.type === 'parallelTxsComponent') {
		return phase.parallelTxsComponent.executionStages.flatMap((stage) =>
			stage.flatMap((batch) => batch)
		);
	}

	throw new Error('Unsupported transaction phase');
}

function extractComponentTransactionEnvelopes(
	component: xdr.TxSetComponent
): readonly xdr.TransactionEnvelope[] {
	if (component.type !== 'txsetCompTxsMaybeDiscountedFee') {
		throw new Error('Unsupported transaction component');
	}

	return component.txsMaybeDiscountedFee.txs;
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
