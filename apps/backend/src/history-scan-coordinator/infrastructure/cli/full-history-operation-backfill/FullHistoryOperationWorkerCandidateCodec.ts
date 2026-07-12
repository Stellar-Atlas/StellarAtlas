import type {
	FullHistoryCandidateLedger,
	FullHistoryCandidateSourceObject,
	FullHistoryCheckpointCandidate
} from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import {
	assertBoundedText,
	assertUuid,
	fullHistoryLedgerSequence
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	readWorkerArray,
	readWorkerDate,
	readWorkerHash,
	readWorkerInteger,
	readWorkerRecord,
	readWorkerString
} from './FullHistoryOperationWorkerValueParser.js';

const maximumCandidateTransactions = 100_000;
const maximumLedgerCount = 64;
const maximumXdrBase64Bytes = 1_500_000;

interface WireSourceObject {
	readonly contentDigest: string;
	readonly remoteId: string;
}

interface WireCandidate {
	readonly envelopes: readonly {
		readonly envelopeXdr: string;
		readonly ledgerSequence: string;
		readonly transactionIndex: number;
		readonly transactionSetHash: string;
	}[];
	readonly ledgers: readonly {
		readonly bucketListHash: string;
		readonly closedAt: string;
		readonly ledgerHash: string;
		readonly ledgerSequence: string;
		readonly previousLedgerHash: string;
		readonly protocolVersion: number;
		readonly transactionResultHash: string;
		readonly transactionSetHash: string;
	}[];
	readonly proof: {
		readonly archiveUrlIdentity: string;
		readonly checkpointLedger: string;
		readonly evaluatedAt: string;
		readonly id: number;
		readonly networkPassphrase: string;
		readonly sources: {
			readonly checkpointState: WireSourceObject;
			readonly ledger: WireSourceObject;
			readonly results: WireSourceObject;
			readonly transactions: WireSourceObject;
		};
		readonly version: number;
	};
	readonly results: readonly {
		readonly ledgerSequence: string;
		readonly resultXdr: string;
		readonly transactionHash: string;
		readonly transactionIndex: number;
		readonly transactionResultHash: string;
	}[];
}

export interface FullHistoryOperationDecodeWorkerRequest {
	readonly candidate: WireCandidate;
	readonly networkPassphrase: string;
}

export function serializeFullHistoryOperationDecodeWorkerRequest(
	candidate: FullHistoryCheckpointCandidate,
	networkPassphrase: string
): FullHistoryOperationDecodeWorkerRequest {
	return {
		candidate: {
			envelopes: candidate.envelopes.map((envelope) => ({
				envelopeXdr: envelope.envelopeXdr,
				ledgerSequence: envelope.ledgerSequence,
				transactionIndex: envelope.transactionIndex,
				transactionSetHash: envelope.transactionSetHash.toHex()
			})),
			ledgers: candidate.ledgers.map((ledger) => ({
				bucketListHash: ledger.bucketListHash.toHex(),
				closedAt: ledger.closedAt.toISOString(),
				ledgerHash: ledger.ledgerHash.toHex(),
				ledgerSequence: ledger.ledgerSequence,
				previousLedgerHash: ledger.previousLedgerHash.toHex(),
				protocolVersion: ledger.protocolVersion,
				transactionResultHash: ledger.transactionResultHash.toHex(),
				transactionSetHash: ledger.transactionSetHash.toHex()
			})),
			proof: {
				archiveUrlIdentity: candidate.proof.archiveUrlIdentity,
				checkpointLedger: candidate.proof.checkpointLedger,
				evaluatedAt: candidate.proof.evaluatedAt.toISOString(),
				id: candidate.proof.id,
				networkPassphrase: candidate.proof.networkPassphrase,
				sources: {
					checkpointState: serializeSource(
						candidate.proof.sources.checkpointState
					),
					ledger: serializeSource(candidate.proof.sources.ledger),
					results: serializeSource(candidate.proof.sources.results),
					transactions: serializeSource(candidate.proof.sources.transactions)
				},
				version: candidate.proof.version
			},
			results: candidate.results.map((result) => ({
				ledgerSequence: result.ledgerSequence,
				resultXdr: result.resultXdr,
				transactionHash: result.transactionHash.toHex(),
				transactionIndex: result.transactionIndex,
				transactionResultHash: result.transactionResultHash.toHex()
			}))
		},
		networkPassphrase
	};
}

export function parseFullHistoryOperationDecodeWorkerRequest(value: unknown): {
	readonly candidate: FullHistoryCheckpointCandidate;
	readonly networkPassphrase: string;
} {
	const request = readWorkerRecord(value, 'worker request');
	const candidate = readWorkerRecord(request.candidate, 'worker candidate');
	const proof = readWorkerRecord(candidate.proof, 'worker candidate proof');
	const sources = readWorkerRecord(proof.sources, 'worker candidate sources');
	const networkPassphrase = assertBoundedText(
		readWorkerString(request.networkPassphrase, 'networkPassphrase', 1_024),
		'networkPassphrase',
		1_024
	);
	return {
		candidate: {
			envelopes: readWorkerArray(
				candidate.envelopes,
				'candidate.envelopes',
				maximumCandidateTransactions
			).map((value, index) => {
				const envelope = readWorkerRecord(value, `envelopes[${index}]`);
				return {
					envelopeXdr: readWorkerString(
						envelope.envelopeXdr,
						`envelopes[${index}].envelopeXdr`,
						maximumXdrBase64Bytes
					),
					ledgerSequence: readLedgerSequence(
						envelope.ledgerSequence,
						`envelopes[${index}].ledgerSequence`
					),
					transactionIndex: readWorkerInteger(
						envelope.transactionIndex,
						`envelopes[${index}].transactionIndex`,
						0
					),
					transactionSetHash: readWorkerHash(
						envelope.transactionSetHash,
						`envelopes[${index}].transactionSetHash`
					)
				};
			}),
			ledgers: readWorkerArray(
				candidate.ledgers,
				'candidate.ledgers',
				maximumLedgerCount
			).map(parseLedger),
			proof: {
				archiveUrlIdentity: assertBoundedText(
					readWorkerString(
						proof.archiveUrlIdentity,
						'proof.archiveUrlIdentity',
						2_048
					),
					'proof.archiveUrlIdentity',
					2_048
				),
				checkpointLedger: readLedgerSequence(
					proof.checkpointLedger,
					'proof.checkpointLedger'
				),
				evaluatedAt: readWorkerDate(proof.evaluatedAt, 'proof.evaluatedAt'),
				id: readWorkerInteger(proof.id, 'proof.id', 1),
				networkPassphrase: assertBoundedText(
					readWorkerString(
						proof.networkPassphrase,
						'proof.networkPassphrase',
						1_024
					),
					'proof.networkPassphrase',
					1_024
				),
				sources: {
					checkpointState: parseSource(
						sources.checkpointState,
						'sources.checkpointState'
					),
					ledger: parseSource(sources.ledger, 'sources.ledger'),
					results: parseSource(sources.results, 'sources.results'),
					transactions: parseSource(
						sources.transactions,
						'sources.transactions'
					)
				},
				version: readWorkerInteger(proof.version, 'proof.version', 1, 32_767)
			},
			results: readWorkerArray(
				candidate.results,
				'candidate.results',
				maximumCandidateTransactions
			).map((value, index) => {
				const result = readWorkerRecord(value, `results[${index}]`);
				return {
					ledgerSequence: readLedgerSequence(
						result.ledgerSequence,
						`results[${index}].ledgerSequence`
					),
					resultXdr: readWorkerString(
						result.resultXdr,
						`results[${index}].resultXdr`,
						maximumXdrBase64Bytes
					),
					transactionHash: readWorkerHash(
						result.transactionHash,
						`results[${index}].transactionHash`
					),
					transactionIndex: readWorkerInteger(
						result.transactionIndex,
						`results[${index}].transactionIndex`,
						0
					),
					transactionResultHash: readWorkerHash(
						result.transactionResultHash,
						`results[${index}].transactionResultHash`
					)
				};
			})
		},
		networkPassphrase
	};
}

function parseLedger(
	value: unknown,
	index: number
): FullHistoryCandidateLedger {
	const ledger = readWorkerRecord(value, `ledgers[${index}]`);
	return {
		bucketListHash: readWorkerHash(
			ledger.bucketListHash,
			`ledgers[${index}].bucketListHash`
		),
		closedAt: readWorkerDate(ledger.closedAt, `ledgers[${index}].closedAt`),
		ledgerHash: readWorkerHash(
			ledger.ledgerHash,
			`ledgers[${index}].ledgerHash`
		),
		ledgerSequence: readLedgerSequence(
			ledger.ledgerSequence,
			`ledgers[${index}].ledgerSequence`
		),
		previousLedgerHash: readWorkerHash(
			ledger.previousLedgerHash,
			`ledgers[${index}].previousLedgerHash`
		),
		protocolVersion: readWorkerInteger(
			ledger.protocolVersion,
			`ledgers[${index}].protocolVersion`,
			1
		),
		transactionResultHash: readWorkerHash(
			ledger.transactionResultHash,
			`ledgers[${index}].transactionResultHash`
		),
		transactionSetHash: readWorkerHash(
			ledger.transactionSetHash,
			`ledgers[${index}].transactionSetHash`
		)
	};
}

function parseSource(
	value: unknown,
	field: string
): FullHistoryCandidateSourceObject {
	const source = readWorkerRecord(value, field);
	return {
		contentDigest: readWorkerHash(
			source.contentDigest,
			`${field}.contentDigest`
		),
		remoteId: assertUuid(
			readWorkerString(source.remoteId, `${field}.remoteId`, 36),
			`${field}.remoteId`
		)
	};
}

function readLedgerSequence(value: unknown, field: string) {
	return fullHistoryLedgerSequence(readWorkerString(value, field, 20), field);
}

function serializeSource(
	source: FullHistoryCandidateSourceObject
): WireSourceObject {
	return {
		contentDigest: source.contentDigest.toHex(),
		remoteId: source.remoteId
	};
}
