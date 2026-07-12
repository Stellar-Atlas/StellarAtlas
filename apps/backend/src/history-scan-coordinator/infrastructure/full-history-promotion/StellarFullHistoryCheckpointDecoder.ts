import { createHash } from 'node:crypto';
import {
	FeeBumpTransaction,
	Transaction,
	TransactionBuilder,
	xdr
} from '@stellar/stellar-sdk';
import {
	FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT,
	FULL_HISTORY_GENESIS_CHECKPOINT_LEDGER_COUNT,
	FULL_HISTORY_REGULAR_CHECKPOINT_LEDGER_COUNT,
	type FullHistoryLedgerInput,
	type FullHistoryTransactionInput,
	type FullHistoryTransactionResultInput
} from '../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	fullHistoryUint64,
	FullHistoryHash
} from '../../domain/full-history/FullHistoryCanonicalTypes.js';
import type {
	FullHistoryCandidateEnvelope,
	FullHistoryCandidateLedger,
	FullHistoryCandidateResult,
	FullHistoryCheckpointCandidate
} from '../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type {
	FullHistoryCheckpointDecoder,
	FullHistoryDecodedCheckpoint
} from '../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import { FullHistoryPromotionError } from '../../domain/full-history-promotion/FullHistoryPromotionError.js';

const maximumXdrBytes = 1_048_576;
const maximumCheckpointXdrBytes = 64 * 1_048_576;
const yieldEveryRecords = 128;

interface DecodedEnvelope {
	readonly sdkTransaction: FeeBumpTransaction | Transaction;
	readonly transaction: FullHistoryTransactionInput;
}

interface DecodedResult {
	readonly canonical: FullHistoryTransactionResultInput;
	readonly xdrPair: xdr.TransactionResultPair;
}

export class StellarFullHistoryCheckpointDecoder implements FullHistoryCheckpointDecoder {
	readonly version = 'stellar-sdk-16/archive-xdr-v1';

	async decode(
		candidate: FullHistoryCheckpointCandidate,
		networkPassphrase: string
	): Promise<FullHistoryDecodedCheckpoint> {
		validateCandidateRange(candidate);
		if (candidate.proof.networkPassphrase !== networkPassphrase) {
			throw new FullHistoryPromotionError(
				'invalid-network-passphrase',
				'Candidate proof and decoder network passphrases differ'
			);
		}
		if (
			candidate.envelopes.length >
				FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT ||
			candidate.envelopes.length !== candidate.results.length
		) {
			throw pairingError(
				'Envelope and result row counts differ or exceed the bound'
			);
		}

		const ledgersBySequence = new Map(
			candidate.ledgers.map((ledger) => [ledger.ledgerSequence, ledger])
		);
		const envelopes = candidate.envelopes.toSorted(compareCandidateRows);
		const results = candidate.results.toSorted(compareCandidateRows);
		validateRowIdentities(envelopes, results, ledgersBySequence);

		let decodedBytes = 0;
		const transactions: FullHistoryTransactionInput[] = [];
		const decodedResults: FullHistoryTransactionResultInput[] = [];
		const resultPairs = new Map<string, xdr.TransactionResultPair[]>();
		const transactionCounts = new Map<string, number>();
		for (const [index, envelope] of envelopes.entries()) {
			const result = results[index]!;
			const ledger = ledgersBySequence.get(envelope.ledgerSequence)!;
			assertCategoryHashes(envelope, result, ledger);
			const envelopeBytes = decodeCanonicalBase64(
				envelope.envelopeXdr,
				'envelope XDR'
			);
			const resultBytes = decodeCanonicalBase64(result.resultXdr, 'result XDR');
			decodedBytes += envelopeBytes.length + resultBytes.length;
			if (decodedBytes > maximumCheckpointXdrBytes) {
				throw new FullHistoryPromotionError(
					'xdr-bound-exceeded',
					'Checkpoint XDR exceeds the total decode byte bound'
				);
			}

			const decodedEnvelope = decodeEnvelope(
				envelope,
				envelopeBytes,
				networkPassphrase
			);
			if (
				!decodedEnvelope.transaction.transactionHash.equals(
					result.transactionHash
				)
			) {
				throw new FullHistoryPromotionError(
					'envelope-hash-mismatch',
					'Recomputed envelope hash does not match its exact result observation'
				);
			}
			const decodedResult = decodeResult(
				result,
				resultBytes,
				decodedEnvelope.sdkTransaction
			);
			transactions.push(decodedEnvelope.transaction);
			decodedResults.push(decodedResult.canonical);
			resultPairs.set(envelope.ledgerSequence, [
				...(resultPairs.get(envelope.ledgerSequence) ?? []),
				decodedResult.xdrPair
			]);
			transactionCounts.set(
				envelope.ledgerSequence,
				(transactionCounts.get(envelope.ledgerSequence) ?? 0) + 1
			);
			if ((index + 1) % yieldEveryRecords === 0) await yieldToEventLoop();
		}
		assertCompleteResultSets(candidate.ledgers, resultPairs);

		const ledgers: FullHistoryLedgerInput[] = candidate.ledgers.map(
			(ledger) => ({
				...ledger,
				transactionCount: transactionCounts.get(ledger.ledgerSequence) ?? 0
			})
		);
		return { ledgers, results: decodedResults, transactions };
	}
}

function validateCandidateRange(
	candidate: FullHistoryCheckpointCandidate
): void {
	const checkpoint = BigInt(candidate.proof.checkpointLedger);
	const genesis = checkpoint === 63n;
	const expectedCount = genesis
		? FULL_HISTORY_GENESIS_CHECKPOINT_LEDGER_COUNT
		: FULL_HISTORY_REGULAR_CHECKPOINT_LEDGER_COUNT;
	const expectedFirst = genesis ? 1n : checkpoint - 63n;
	if (
		checkpoint % 64n !== 63n ||
		candidate.ledgers.length !== expectedCount ||
		candidate.ledgers.some(
			(ledger, index) =>
				BigInt(ledger.ledgerSequence) !== expectedFirst + BigInt(index)
		)
	) {
		throw new FullHistoryPromotionError(
			'ledger-range-mismatch',
			'Candidate does not contain the exact checkpoint ledger range'
		);
	}
	for (let index = 1; index < candidate.ledgers.length; index += 1) {
		if (
			!candidate.ledgers[index]!.previousLedgerHash.equals(
				candidate.ledgers[index - 1]!.ledgerHash
			)
		) {
			throw new FullHistoryPromotionError(
				'ledger-range-mismatch',
				'Candidate ledger hash chain is discontinuous'
			);
		}
	}
}

function validateRowIdentities(
	envelopes: readonly FullHistoryCandidateEnvelope[],
	results: readonly FullHistoryCandidateResult[],
	ledgers: ReadonlyMap<string, FullHistoryCandidateLedger>
): void {
	const nextIndex = new Map<string, number>();
	for (const [position, envelope] of envelopes.entries()) {
		const result = results[position];
		const expectedIndex = nextIndex.get(envelope.ledgerSequence) ?? 0;
		if (
			result === undefined ||
			result.ledgerSequence !== envelope.ledgerSequence ||
			result.transactionIndex !== envelope.transactionIndex ||
			ledgers.get(envelope.ledgerSequence) === undefined ||
			envelope.transactionIndex !== expectedIndex
		) {
			throw pairingError(
				'Envelope and result rows are not exact contiguous ledger/index pairs'
			);
		}
		nextIndex.set(envelope.ledgerSequence, expectedIndex + 1);
	}
}

function assertCategoryHashes(
	envelope: FullHistoryCandidateEnvelope,
	result: FullHistoryCandidateResult,
	ledger: FullHistoryCandidateLedger
): void {
	if (
		!envelope.transactionSetHash.equals(ledger.transactionSetHash) ||
		!result.transactionResultHash.equals(ledger.transactionResultHash)
	) {
		throw new FullHistoryPromotionError(
			'category-hash-mismatch',
			'Observed transaction category hash does not match its exact ledger'
		);
	}
}

function decodeEnvelope(
	candidate: FullHistoryCandidateEnvelope,
	bytes: Buffer,
	networkPassphrase: string
): DecodedEnvelope {
	try {
		const envelopeXdr = xdr.TransactionEnvelope.fromXDR(bytes);
		const sdkTransaction = TransactionBuilder.fromXDR(
			envelopeXdr,
			networkPassphrase
		);
		const transactionHash = FullHistoryHash.fromBytes(sdkTransaction.hash());
		if (sdkTransaction instanceof FeeBumpTransaction) {
			return {
				sdkTransaction,
				transaction: {
					envelopeType: 'fee-bump',
					feeBid: fullHistoryUint64(sdkTransaction.fee, 'feeBid'),
					ledgerSequence: candidate.ledgerSequence,
					operationCount: sdkTransaction.innerTransaction.operations.length,
					sourceAccount: sdkTransaction.innerTransaction.source,
					sourceAccountSequence: fullHistoryUint64(
						sdkTransaction.innerTransaction.sequence,
						'sourceAccountSequence'
					),
					transactionHash,
					transactionIndex: candidate.transactionIndex
				}
			};
		}
		const envelopeType = envelopeXdr.switch().value;
		if (
			!(sdkTransaction instanceof Transaction) ||
			![0, 2].includes(envelopeType)
		) {
			throw new Error('Unsupported transaction envelope type');
		}
		return {
			sdkTransaction,
			transaction: {
				envelopeType: envelopeType === 0 ? 'tx-v0' : 'tx',
				feeBid: fullHistoryUint64(sdkTransaction.fee, 'feeBid'),
				ledgerSequence: candidate.ledgerSequence,
				operationCount: sdkTransaction.operations.length,
				sourceAccount: sdkTransaction.source,
				sourceAccountSequence: fullHistoryUint64(
					sdkTransaction.sequence,
					'sourceAccountSequence'
				),
				transactionHash,
				transactionIndex: candidate.transactionIndex
			}
		};
	} catch (error) {
		if (error instanceof FullHistoryPromotionError) throw error;
		throw new FullHistoryPromotionError(
			'xdr-decode-failed',
			'Envelope XDR could not be decoded into a supported Stellar transaction',
			{ cause: error }
		);
	}
}

function decodeResult(
	candidate: FullHistoryCandidateResult,
	bytes: Buffer,
	transaction: FeeBumpTransaction | Transaction
): DecodedResult {
	try {
		const decoded = xdr.TransactionResult.fromXDR(bytes);
		const resultCode = decoded.result().switch().value;
		const feeBump = transaction instanceof FeeBumpTransaction;
		let operationResultCount = 0;
		if (resultCode === 0 || resultCode === -1) {
			if (feeBump) throw pairingError('Fee-bump envelope has a classic result');
			operationResultCount = decoded.result().results().length;
		} else if (resultCode === 1 || resultCode === -13) {
			if (!feeBump)
				throw pairingError('Classic envelope has a fee-bump result');
			const innerPair = decoded.result().innerResultPair();
			if (
				!innerPair.transactionHash().equals(transaction.innerTransaction.hash())
			) {
				throw pairingError(
					'Fee-bump inner result hash does not match its envelope'
				);
			}
			const innerResult = innerPair.result().result();
			const innerCode = innerResult.switch().value;
			if (innerCode === 0 || innerCode === -1) {
				operationResultCount = innerResult.results().length;
			}
		}
		return {
			canonical: {
				feeCharged: fullHistoryUint64(
					decoded.feeCharged().toString(),
					'feeCharged'
				),
				ledgerSequence: candidate.ledgerSequence,
				operationResultCount,
				resultCode,
				successful: resultCode === 0 || resultCode === 1,
				transactionHash: candidate.transactionHash,
				transactionIndex: candidate.transactionIndex
			},
			xdrPair: new xdr.TransactionResultPair({
				result: decoded,
				transactionHash: candidate.transactionHash.toBuffer()
			})
		};
	} catch (error) {
		if (error instanceof FullHistoryPromotionError) throw error;
		throw new FullHistoryPromotionError(
			'xdr-decode-failed',
			'Result XDR could not be decoded into a supported Stellar result',
			{ cause: error }
		);
	}
}

function assertCompleteResultSets(
	ledgers: readonly FullHistoryCandidateLedger[],
	resultPairs: ReadonlyMap<string, readonly xdr.TransactionResultPair[]>
): void {
	for (const ledger of ledgers) {
		const encoded = new xdr.TransactionResultSet({
			results: [...(resultPairs.get(ledger.ledgerSequence) ?? [])]
		}).toXDR();
		const recomputed = FullHistoryHash.fromBytes(
			createHash('sha256').update(encoded).digest()
		);
		if (!recomputed.equals(ledger.transactionResultHash)) {
			throw new FullHistoryPromotionError(
				'category-hash-mismatch',
				'Reconstructed result-set hash does not match its exact ledger'
			);
		}
	}
}

function decodeCanonicalBase64(value: string, field: string): Buffer {
	const maximumBase64Length = Math.ceil(maximumXdrBytes / 3) * 4;
	if (value.length > maximumBase64Length) {
		throw new FullHistoryPromotionError(
			'xdr-bound-exceeded',
			`${field} exceeds the per-record decode byte bound`
		);
	}
	const bytes = Buffer.from(value, 'base64');
	if (
		value.length === 0 ||
		value.length % 4 !== 0 ||
		bytes.toString('base64') !== value
	) {
		throw new FullHistoryPromotionError(
			'xdr-decode-failed',
			`${field} is not canonical base64`
		);
	}
	if (bytes.length > maximumXdrBytes) {
		throw new FullHistoryPromotionError(
			'xdr-bound-exceeded',
			`${field} exceeds the per-record decode byte bound`
		);
	}
	return bytes;
}

function compareCandidateRows(
	left: FullHistoryCandidateEnvelope | FullHistoryCandidateResult,
	right: FullHistoryCandidateEnvelope | FullHistoryCandidateResult
): number {
	const ledgerOrder =
		BigInt(left.ledgerSequence) - BigInt(right.ledgerSequence);
	return ledgerOrder === 0n
		? left.transactionIndex - right.transactionIndex
		: ledgerOrder < 0n
			? -1
			: 1;
}

function pairingError(message: string): FullHistoryPromotionError {
	return new FullHistoryPromotionError('transaction-pairing-mismatch', message);
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}
