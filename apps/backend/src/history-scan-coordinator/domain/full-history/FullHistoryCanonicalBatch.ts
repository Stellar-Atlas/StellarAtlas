import { StrKey } from '@stellar/stellar-sdk';
import {
	assertBoundedText,
	assertInteger,
	assertUuid,
	assertValidDate,
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash,
	type FullHistoryLedgerSequence,
	type FullHistoryUint64String
} from './FullHistoryCanonicalTypes.js';

export const FULL_HISTORY_REGULAR_CHECKPOINT_LEDGER_COUNT = 64;
export const FULL_HISTORY_GENESIS_CHECKPOINT_LEDGER_COUNT = 63;
export const FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT = 100_000;

export type FullHistoryEnvelopeType = 'fee-bump' | 'tx' | 'tx-v0';

export interface FullHistorySourceObject {
	readonly contentDigest: FullHistoryHash;
	readonly remoteId: string;
}

export interface FullHistoryCheckpointSources {
	readonly checkpointState: FullHistorySourceObject;
	readonly ledger: FullHistorySourceObject;
	readonly results: FullHistorySourceObject;
	readonly transactions: FullHistorySourceObject;
}

export interface FullHistoryLedgerInput {
	readonly bucketListHash: FullHistoryHash;
	readonly closedAt: Date;
	readonly ledgerHash: FullHistoryHash;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly previousLedgerHash: FullHistoryHash;
	readonly protocolVersion: number;
	readonly transactionCount: number;
	readonly transactionResultHash: FullHistoryHash;
	readonly transactionSetHash: FullHistoryHash;
}

export interface FullHistoryTransactionInput {
	readonly envelopeType: FullHistoryEnvelopeType;
	readonly feeBid: FullHistoryUint64String;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationCount: number;
	readonly sourceAccount: string;
	readonly sourceAccountSequence: FullHistoryUint64String;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
}

export interface FullHistoryTransactionResultInput {
	readonly feeCharged: FullHistoryUint64String;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationResultCount: number;
	readonly resultCode: number;
	readonly successful: boolean;
	readonly transactionHash: FullHistoryHash;
	readonly transactionIndex: number;
}

export interface FullHistoryCheckpointWrite {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly checkpointLedger: FullHistoryLedgerSequence;
	readonly decoderVersion: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
	readonly ledgers: readonly FullHistoryLedgerInput[];
	readonly networkPassphrase: string;
	readonly proofEvaluatedAt: Date;
	readonly proofId: number;
	readonly proofVersion: number;
	readonly results: readonly FullHistoryTransactionResultInput[];
	readonly sources: FullHistoryCheckpointSources;
	readonly transactions: readonly FullHistoryTransactionInput[];
}

export function validateFullHistoryCheckpointWrite(
	input: FullHistoryCheckpointWrite
): void {
	assertUuid(input.batchId, 'batchId');
	assertBoundedText(input.networkPassphrase, 'networkPassphrase', 1_024);
	assertBoundedText(input.archiveUrlIdentity, 'archiveUrlIdentity', 2_048);
	assertBoundedText(input.decoderVersion, 'decoderVersion', 128);
	assertInteger(input.proofId, 'proofId', 1);
	assertInteger(input.proofVersion, 'proofVersion', 1, 32_767);
	assertValidDate(input.proofEvaluatedAt, 'proofEvaluatedAt');
	fullHistoryLedgerSequence(input.checkpointLedger, 'checkpointLedger');
	fullHistoryLedgerSequence(input.firstLedger, 'firstLedger');
	fullHistoryLedgerSequence(input.lastLedger, 'lastLedger');
	validateSources(input.sources);
	validateLedgerRange(input);
	validateTransactions(input);
}

function validateSources(sources: FullHistoryCheckpointSources): void {
	const identities = Object.values(sources).map((source) =>
		assertUuid(source.remoteId, 'source.remoteId')
	);
	if (new Set(identities).size !== identities.length) {
		throw new Error('Full-history source object identities must be unique');
	}
	for (const source of Object.values(sources)) {
		assertHash(source.contentDigest, 'source.contentDigest');
	}
}

function validateLedgerRange(input: FullHistoryCheckpointWrite): void {
	const first = BigInt(input.firstLedger);
	const last = BigInt(input.lastLedger);
	const genesis = last === 63n;
	const expectedFirst = genesis ? 1n : last - 63n;
	const expectedCount = genesis
		? FULL_HISTORY_GENESIS_CHECKPOINT_LEDGER_COUNT
		: FULL_HISTORY_REGULAR_CHECKPOINT_LEDGER_COUNT;
	if (
		input.checkpointLedger !== input.lastLedger ||
		first !== expectedFirst ||
		last % 64n !== 63n ||
		input.ledgers.length !== expectedCount
	) {
		throw new Error(
			'A canonical batch must contain the exact global checkpoint ledger range'
		);
	}

	const hashes = new Set<string>();
	for (const [index, ledger] of input.ledgers.entries()) {
		const expectedSequence = (first + BigInt(index)).toString();
		if (ledger.ledgerSequence !== expectedSequence) {
			throw new Error('Canonical ledgers must be complete and contiguous');
		}
		validateLedger(ledger);
		if (hashes.has(ledger.ledgerHash.toHex())) {
			throw new Error('Canonical ledger hashes must be unique');
		}
		hashes.add(ledger.ledgerHash.toHex());
		if (
			index > 0 &&
			!ledger.previousLedgerHash.equals(input.ledgers[index - 1]!.ledgerHash)
		) {
			throw new Error('Canonical ledger hash chain is discontinuous');
		}
	}
}

function validateLedger(ledger: FullHistoryLedgerInput): void {
	assertHash(ledger.ledgerHash, 'ledgerHash');
	assertHash(ledger.previousLedgerHash, 'previousLedgerHash');
	assertHash(ledger.transactionSetHash, 'transactionSetHash');
	assertHash(ledger.transactionResultHash, 'transactionResultHash');
	assertHash(ledger.bucketListHash, 'bucketListHash');
	assertInteger(ledger.protocolVersion, 'protocolVersion', 1);
	assertInteger(ledger.transactionCount, 'transactionCount', 0);
	assertValidDate(ledger.closedAt, 'closedAt');
}

function validateTransactions(input: FullHistoryCheckpointWrite): void {
	if (
		input.transactions.length > FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT ||
		input.results.length !== input.transactions.length
	) {
		throw new RangeError('Canonical transaction and result counts are invalid');
	}

	const ledgerCounts = new Map<string, number>();
	const ledgerIndexes = new Map<string, number[]>();
	const transactionHashes = new Set<string>();
	const transactionIdentities = new Set<string>();
	for (const transaction of input.transactions) {
		validateTransaction(transaction);
		const sequence = transaction.ledgerSequence;
		if (
			BigInt(sequence) < BigInt(input.firstLedger) ||
			BigInt(sequence) > BigInt(input.lastLedger)
		) {
			throw new Error('Canonical transaction falls outside its checkpoint');
		}
		const identity = `${sequence}:${transaction.transactionIndex}`;
		const hash = transaction.transactionHash.toHex();
		if (transactionIdentities.has(identity) || transactionHashes.has(hash)) {
			throw new Error('Canonical transaction identities must be unique');
		}
		transactionIdentities.add(identity);
		transactionHashes.add(hash);
		ledgerCounts.set(sequence, (ledgerCounts.get(sequence) ?? 0) + 1);
		ledgerIndexes.set(sequence, [
			...(ledgerIndexes.get(sequence) ?? []),
			transaction.transactionIndex
		]);
	}

	for (const ledger of input.ledgers) {
		if (
			(ledgerCounts.get(ledger.ledgerSequence) ?? 0) !== ledger.transactionCount
		) {
			throw new Error(
				'Canonical ledger transaction count does not match its rows'
			);
		}
		const indexes = (ledgerIndexes.get(ledger.ledgerSequence) ?? []).toSorted(
			(left, right) => left - right
		);
		if (indexes.some((value, index) => value !== index)) {
			throw new Error('Canonical transaction indexes must be contiguous');
		}
	}

	const resultIdentities = new Set<string>();
	const transactionsByHash = new Map(
		input.transactions.map((transaction) => [
			transaction.transactionHash.toHex(),
			transaction
		])
	);
	for (const result of input.results) {
		validateResult(result);
		const hash = result.transactionHash.toHex();
		const transaction = transactionsByHash.get(hash);
		const identity = `${result.ledgerSequence}:${result.transactionIndex}:${hash}`;
		if (
			transaction === undefined ||
			transaction.ledgerSequence !== result.ledgerSequence ||
			transaction.transactionIndex !== result.transactionIndex ||
			result.operationResultCount > transaction.operationCount ||
			resultIdentities.has(identity)
		) {
			throw new Error('Canonical results must map one-to-one to transactions');
		}
		resultIdentities.add(identity);
	}
}

function validateTransaction(transaction: FullHistoryTransactionInput): void {
	assertHash(transaction.transactionHash, 'transactionHash');
	fullHistoryLedgerSequence(transaction.ledgerSequence);
	fullHistoryUint64(transaction.sourceAccountSequence, 'sourceAccountSequence');
	fullHistoryUint64(transaction.feeBid, 'feeBid');
	assertInteger(transaction.transactionIndex, 'transactionIndex', 0);
	assertInteger(transaction.operationCount, 'operationCount', 0);
	if (!['fee-bump', 'tx', 'tx-v0'].includes(transaction.envelopeType)) {
		throw new Error('envelopeType is unsupported');
	}
	if (
		!StrKey.isValidEd25519PublicKey(transaction.sourceAccount) &&
		!StrKey.isValidMed25519PublicKey(transaction.sourceAccount)
	) {
		throw new Error('sourceAccount must be a valid Stellar account StrKey');
	}
}

function validateResult(result: FullHistoryTransactionResultInput): void {
	assertHash(result.transactionHash, 'transactionHash');
	fullHistoryLedgerSequence(result.ledgerSequence);
	fullHistoryUint64(result.feeCharged, 'feeCharged');
	assertInteger(result.transactionIndex, 'transactionIndex', 0);
	assertInteger(result.resultCode, 'resultCode', -0x8000_0000, 0x7fff_ffff);
	assertInteger(result.operationResultCount, 'operationResultCount', 0);
	if (typeof result.successful !== 'boolean') {
		throw new TypeError('successful must be a boolean');
	}
}

function assertHash(value: FullHistoryHash, field: string): void {
	if (!(value instanceof FullHistoryHash)) {
		throw new TypeError(`${field} must be a FullHistoryHash`);
	}
}
