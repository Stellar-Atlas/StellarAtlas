import { createHash } from 'node:crypto';
import { xdr } from '@stellar/stellar-sdk';
import { FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT } from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import type {
	FullHistoryCandidateEnvelopeRow,
	FullHistoryCandidateLedgerRow,
	FullHistoryCandidateResultRow
} from '../database/full-history-promotion/FullHistoryCandidateRowMapper.js';

export const maximumRawCheckpointBytes = 64 * 1024 ** 2;
export interface RawCheckpointInput {
	readonly checkpointLedger: number;
	readonly ledger: Uint8Array;
	readonly transactions: Uint8Array;
	readonly results: Uint8Array;
}
export interface RawCheckpointRows {
	readonly ledgers: FullHistoryCandidateLedgerRow[];
	readonly envelopes: FullHistoryCandidateEnvelopeRow[];
	readonly results: FullHistoryCandidateResultRow[];
}

/** Rebuild only an in-memory candidate; never repopulate legacy parsed tables. */
export function decodeRawCheckpoint(
	input: RawCheckpointInput
): RawCheckpointRows {
	const ledgers = readArchiveFrames(input.ledger).map((bytes) => {
		const entry = xdr.LedgerHeaderHistoryEntry.fromXDR(bytes);
		const header = entry.header;
		const ledgerHeaderHash = digest(header.toXDR());
		requireEqual(
			ledgerHeaderHash,
			base64(entry.hash.toBytes()),
			'ledger header hash'
		);
		return {
			ledgerSequence: header.ledgerSeq,
			ledgerHeaderHash,
			previousLedgerHeaderHash: base64(header.previousLedgerHash.toBytes()),
			transactionSetHash: base64(header.scpValue.txSetHash.toBytes()),
			transactionResultHash: base64(header.txSetResultHash.toBytes()),
			bucketListHash: base64(header.bucketListHash.toBytes()),
			protocolVersion: header.ledgerVersion,
			closedAt: new Date(Number(header.scpValue.closeTime) * 1000).toISOString()
		};
	});
	const first = input.checkpointLedger === 63 ? 1 : input.checkpointLedger - 63;
	if (ledgers.length !== input.checkpointLedger - first + 1)
		throw new Error('Incomplete raw ledger range');
	for (const [index, ledger] of ledgers.entries()) {
		if (ledger.ledgerSequence !== first + index)
			throw new Error('Unordered raw ledger range');
		if (index > 0)
			requireEqual(
				ledger.previousLedgerHeaderHash,
				ledgers[index - 1]!.ledgerHeaderHash,
				'ledger chain'
			);
	}
	const byLedger = new Map(
		ledgers.map((ledger) => [ledger.ledgerSequence, ledger])
	);
	const transactionLedgers = new Set<number>();
	const resultLedgers = new Set<number>();
	const envelopes: FullHistoryCandidateEnvelopeRow[] = [];
	const results: FullHistoryCandidateResultRow[] = [];
	let payloadBytes = 0;
	for (const bytes of readArchiveFrames(input.transactions)) {
		const entry = xdr.TransactionHistoryEntry.fromXDR(bytes);
		const header = byLedger.get(entry.ledgerSeq);
		if (!header || transactionLedgers.has(entry.ledgerSeq))
			throw new Error('Duplicate or out-of-range transaction ledger');
		transactionLedgers.add(entry.ledgerSeq);
		const generalized =
			entry.ext.type === 'generalizedTxSet' ? entry.ext.generalizedTxSet : null;
		const previous = generalized
			? generalized.v1TxSet.previousLedgerHash
			: entry.txSet.previousLedgerHash;
		requireEqual(
			base64(previous.toBytes()),
			header.previousLedgerHeaderHash,
			'transaction predecessor'
		);
		const transactions = generalized
			? generalizedEnvelopes(generalized)
			: entry.txSet.txs;
		const transactionSetHash = generalized
			? digest(generalized.toXDR())
			: digest(
					Buffer.concat([
						previous.toBytes(),
						...transactions.map((transaction) => transaction.toXDR())
					])
				);
		requireEqual(
			transactionSetHash,
			header.transactionSetHash,
			'transaction set hash'
		);
		for (const [transactionIndex, envelope] of transactions.entries()) {
			const encoded = envelope.toXDR();
			payloadBytes += encoded.length;
			checkBound(payloadBytes, envelopes.length + 1);
			envelopes.push({
				ledgerSequence: entry.ledgerSeq,
				transactionIndex,
				transactionSetHash,
				envelopeXdr: base64(encoded)
			});
		}
	}
	for (const bytes of readArchiveFrames(input.results)) {
		const entry = xdr.TransactionHistoryResultEntry.fromXDR(bytes);
		const header = byLedger.get(entry.ledgerSeq);
		if (!header || resultLedgers.has(entry.ledgerSeq))
			throw new Error('Duplicate or out-of-range result ledger');
		resultLedgers.add(entry.ledgerSeq);
		const transactionResultHash = digest(entry.txResultSet.toXDR());
		requireEqual(
			transactionResultHash,
			header.transactionResultHash,
			'transaction result set hash'
		);
		for (const [
			transactionIndex,
			pair
		] of entry.txResultSet.results.entries()) {
			const encoded = pair.result.toXDR();
			payloadBytes += encoded.length;
			checkBound(payloadBytes, results.length + 1);
			results.push({
				ledgerSequence: entry.ledgerSeq,
				transactionIndex,
				transactionResultHash,
				transactionHash: base64(pair.transactionHash.toBytes()),
				resultXdr: base64(encoded)
			});
		}
	}
	const emptyResultsHash = digest(
		new xdr.TransactionResultSet({ results: [] }).toXDR()
	);
	for (const ledger of ledgers) {
		if (!transactionLedgers.has(ledger.ledgerSequence))
			requireEqual(
				digest(Buffer.from(ledger.previousLedgerHeaderHash, 'base64')),
				ledger.transactionSetHash,
				'omitted empty transaction set'
			);
		if (!resultLedgers.has(ledger.ledgerSequence))
			requireEqual(
				emptyResultsHash,
				ledger.transactionResultHash,
				'omitted empty result set'
			);
	}
	if (envelopes.length !== results.length)
		throw new Error('Transaction/result counts differ');
	return { ledgers, envelopes, results };
}

export function readArchiveFrames(input: Uint8Array): Buffer[] {
	if (input.byteLength > maximumRawCheckpointBytes)
		throw new Error('Raw checkpoint exceeds byte bound');
	const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const records: Buffer[] = [];
	let offset = 0;
	while (offset < bytes.length) {
		if (bytes.length - offset < 4)
			throw new Error('Truncated archive record marker');
		const length = bytes.readUInt32BE(offset) & 0x7fffffff;
		offset += 4;
		if (length === 0 || length > bytes.length - offset || records.length >= 64)
			throw new Error('Invalid or excessive archive records');
		records.push(bytes.subarray(offset, offset + length));
		offset += length;
	}
	return records;
}

function generalizedEnvelopes(
	set: xdr.GeneralizedTransactionSet
): xdr.TransactionEnvelope[] {
	return set.v1TxSet.phases.flatMap((phase) => {
		if (phase.type === 'parallelTxsComponent')
			return phase.parallelTxsComponent.executionStages.flatMap((stage) =>
				stage.flatMap((batch) => batch)
			);
		if (phase.type !== 'v0Components')
			throw new Error('Unsupported transaction phase');
		return phase.v0Components.flatMap((component) => {
			if (component.type !== 'txsetCompTxsMaybeDiscountedFee')
				throw new Error('Unsupported transaction component');
			return component.txsMaybeDiscountedFee.txs;
		});
	});
}

function checkBound(bytes: number, count: number): void {
	if (
		bytes > maximumRawCheckpointBytes ||
		count > FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT
	)
		throw new Error('Raw candidate exceeds existing decode bound');
}
function base64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}
function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('base64');
}
function requireEqual(actual: string, expected: string, label: string): void {
	if (actual !== expected) throw new Error(`Raw archive ${label} mismatch`);
}
