import type { DataSource, EntityManager } from 'typeorm';
import type {
	FullHistoryCandidateSourceObject,
	FullHistoryCandidateSources,
	FullHistoryCheckpointCandidate,
	FullHistoryPromotionTarget
} from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type { FullHistoryCheckpointCandidateRepository } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidateRepository.js';
import { FullHistoryPromotionError } from '../../../domain/full-history-promotion/FullHistoryPromotionError.js';
import { FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	assertBoundedText,
	assertInteger,
	assertUuid,
	assertValidDate,
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	mapFullHistoryCandidateEnvelope,
	mapFullHistoryCandidateLedger,
	mapFullHistoryCandidateResult,
	readFullHistoryDatabaseBigint,
	validateFullHistoryCandidateLedgerRange,
	type FullHistoryCandidateEnvelopeRow,
	type FullHistoryCandidateLedgerRow,
	type FullHistoryCandidateResultRow
} from './FullHistoryCandidateRowMapper.js';
import {
	fullHistoryObservedEnvelopesSql,
	fullHistoryObservedLedgersSql,
	fullHistoryObservedResultsSql,
	fullHistoryObservedTransactionBoundsSql,
	fullHistoryProofSql,
	fullHistorySourceObjectsSql
} from './FullHistoryCandidateSql.js';

const maximumCheckpointBase64Bytes = 89_478_488n;

interface ProofRow {
	readonly archiveUrlIdentity: string;
	readonly bucketsVerified: boolean;
	readonly checkpointBucketListMatches: boolean;
	readonly checkpointLedger: number;
	readonly checkpointStateObjectRemoteId: string | null;
	readonly details: unknown;
	readonly evaluatedAt: Date | string;
	readonly failureKind: string | null;
	readonly id: number;
	readonly ledgerFactCount: number;
	readonly ledgerObjectRemoteId: string | null;
	readonly previousLedgersMatch: boolean;
	readonly proofFactsComplete: boolean;
	readonly proofVersion: number;
	readonly requiredObjectsComplete: boolean;
	readonly resultFactCount: number;
	readonly resultsMatch: boolean;
	readonly resultsObjectRemoteId: string | null;
	readonly status: string;
	readonly transactionFactCount: number;
	readonly transactionsMatch: boolean;
	readonly transactionsObjectRemoteId: string | null;
}

interface SourceObjectRow {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number | null;
	readonly objectType: string;
	readonly remoteId: string;
	readonly status: string;
	readonly verificationFacts: unknown;
}

interface TransactionBoundsRow {
	readonly envelopeBytes: string;
	readonly envelopeCount: string;
	readonly resultBytes: string;
	readonly resultCount: string;
}

export class TypeOrmFullHistoryCheckpointCandidateRepository implements FullHistoryCheckpointCandidateRepository {
	constructor(private readonly dataSource: DataSource) {}

	async load(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryCheckpointCandidate> {
		validateTarget(target);
		return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
			await manager.query(`
				set transaction read only;
				set local lock_timeout = '2s';
				set local statement_timeout = '30s'
			`);
			return loadCandidate(manager, target);
		});
	}
}

async function loadCandidate(
	manager: EntityManager,
	target: FullHistoryPromotionTarget
): Promise<FullHistoryCheckpointCandidate> {
	const proofRows = (await manager.query(fullHistoryProofSql, [
		target.archiveUrlIdentity,
		target.checkpointLedger
	])) as ProofRow[];
	if (proofRows.length !== 1) {
		throw promotionError(
			'invalid-proof',
			'Checkpoint proof is missing or ambiguous'
		);
	}
	const proof = proofRows[0]!;
	const expectedLedgerCount = target.checkpointLedger === 63 ? 63 : 64;
	const networkPassphrase = readNetworkPassphrase(proof.details);
	validateProof(proof, target, expectedLedgerCount, networkPassphrase);
	const sourceIds = readProofSourceIds(proof);
	const sourceRows = (await manager.query(fullHistorySourceObjectsSql, [
		Object.values(sourceIds)
	])) as SourceObjectRow[];
	const sources = mapSources(sourceRows, sourceIds, target);

	const ledgerRows = (await manager.query(fullHistoryObservedLedgersSql, [
		sources.ledger.remoteId
	])) as FullHistoryCandidateLedgerRow[];
	const boundsRows = (await manager.query(
		fullHistoryObservedTransactionBoundsSql,
		[sources.transactions.remoteId, sources.results.remoteId]
	)) as TransactionBoundsRow[];
	validateTransactionBounds(boundsRows);
	const envelopeRows = (await manager.query(fullHistoryObservedEnvelopesSql, [
		sources.transactions.remoteId,
		FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT + 1
	])) as FullHistoryCandidateEnvelopeRow[];
	const resultRows = (await manager.query(fullHistoryObservedResultsSql, [
		sources.results.remoteId,
		FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT + 1
	])) as FullHistoryCandidateResultRow[];
	if (
		ledgerRows.length !== expectedLedgerCount ||
		envelopeRows.length > FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT ||
		resultRows.length > FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT
	) {
		throw promotionError(
			'candidate-incomplete',
			'Observed checkpoint row counts are incomplete or exceed their bound'
		);
	}
	const ledgers = ledgerRows.map(mapFullHistoryCandidateLedger);
	validateFullHistoryCandidateLedgerRange(ledgers, target.checkpointLedger);

	return {
		envelopes: envelopeRows.map(mapFullHistoryCandidateEnvelope),
		ledgers,
		proof: {
			archiveUrlIdentity: proof.archiveUrlIdentity,
			checkpointLedger: fullHistoryLedgerSequence(
				BigInt(proof.checkpointLedger)
			),
			evaluatedAt: toDate(proof.evaluatedAt, 'proof.evaluatedAt'),
			id: assertInteger(proof.id, 'proof.id', 1),
			networkPassphrase,
			sources,
			version: assertInteger(proof.proofVersion, 'proof.version', 1, 32_767)
		},
		results: resultRows.map(mapFullHistoryCandidateResult)
	};
}

function validateTransactionBounds(
	rows: readonly TransactionBoundsRow[]
): void {
	const bounds = rows[0];
	if (rows.length !== 1 || bounds === undefined) {
		throw promotionError(
			'candidate-incomplete',
			'Transaction bounds are missing'
		);
	}
	const envelopeCount = readFullHistoryDatabaseBigint(bounds.envelopeCount);
	const resultCount = readFullHistoryDatabaseBigint(bounds.resultCount);
	const encodedBytes =
		readFullHistoryDatabaseBigint(bounds.envelopeBytes) +
		readFullHistoryDatabaseBigint(bounds.resultBytes);
	if (
		envelopeCount !== resultCount ||
		envelopeCount > BigInt(FULL_HISTORY_MAX_TRANSACTIONS_PER_CHECKPOINT) ||
		encodedBytes > maximumCheckpointBase64Bytes
	) {
		throw promotionError(
			'xdr-bound-exceeded',
			'Observed transaction XDR counts or bytes exceed the checkpoint bound'
		);
	}
}

function validateTarget(target: FullHistoryPromotionTarget): void {
	assertBoundedText(target.archiveUrlIdentity, 'archiveUrlIdentity', 2_048);
	assertBoundedText(target.networkPassphrase, 'networkPassphrase', 1_024);
	assertInteger(target.checkpointLedger, 'checkpointLedger', 63, 0xffff_ffff);
	if (target.checkpointLedger % 64 !== 63) {
		throw promotionError(
			'ledger-range-mismatch',
			'Promotion target is not a Stellar checkpoint ledger'
		);
	}
}

function validateProof(
	proof: ProofRow,
	target: FullHistoryPromotionTarget,
	expectedLedgerCount: number,
	networkPassphrase: string
): void {
	if (networkPassphrase !== target.networkPassphrase) {
		throw promotionError(
			'invalid-network-passphrase',
			'Checkpoint proof belongs to a different network passphrase'
		);
	}
	if (
		proof.status !== 'verified' ||
		proof.failureKind !== null ||
		!proof.requiredObjectsComplete ||
		!proof.proofFactsComplete ||
		!proof.checkpointBucketListMatches ||
		!proof.transactionsMatch ||
		!proof.resultsMatch ||
		!proof.previousLedgersMatch ||
		!proof.bucketsVerified ||
		proof.ledgerFactCount !== expectedLedgerCount ||
		proof.transactionFactCount !== expectedLedgerCount ||
		proof.resultFactCount !== expectedLedgerCount
	) {
		throw promotionError(
			'invalid-proof',
			'Checkpoint proof is not strictly verified'
		);
	}
}

function readProofSourceIds(
	proof: ProofRow
): Record<keyof FullHistoryCandidateSources, string> {
	return {
		checkpointState: assertUuid(
			proof.checkpointStateObjectRemoteId ?? '',
			'checkpointStateObjectRemoteId'
		),
		ledger: assertUuid(
			proof.ledgerObjectRemoteId ?? '',
			'ledgerObjectRemoteId'
		),
		results: assertUuid(
			proof.resultsObjectRemoteId ?? '',
			'resultsObjectRemoteId'
		),
		transactions: assertUuid(
			proof.transactionsObjectRemoteId ?? '',
			'transactionsObjectRemoteId'
		)
	};
}

function mapSources(
	rows: readonly SourceObjectRow[],
	ids: Record<keyof FullHistoryCandidateSources, string>,
	target: FullHistoryPromotionTarget
): FullHistoryCandidateSources {
	if (rows.length !== 4) {
		throw promotionError(
			'invalid-source-evidence',
			'Proof source objects are missing or duplicated'
		);
	}
	const byId = new Map(rows.map((row) => [row.remoteId, row]));
	return {
		checkpointState: mapSource(
			byId.get(ids.checkpointState),
			ids.checkpointState,
			'checkpoint-state',
			'canonical-json',
			target
		),
		ledger: mapSource(
			byId.get(ids.ledger),
			ids.ledger,
			'ledger',
			'uncompressed-xdr',
			target
		),
		results: mapSource(
			byId.get(ids.results),
			ids.results,
			'results',
			'uncompressed-xdr',
			target
		),
		transactions: mapSource(
			byId.get(ids.transactions),
			ids.transactions,
			'transactions',
			'uncompressed-xdr',
			target
		)
	};
}

function mapSource(
	row: SourceObjectRow | undefined,
	remoteId: string,
	objectType: string,
	representation: string,
	target: FullHistoryPromotionTarget
): FullHistoryCandidateSourceObject {
	if (
		row === undefined ||
		row.remoteId !== remoteId ||
		row.archiveUrlIdentity !== target.archiveUrlIdentity ||
		row.checkpointLedger !== target.checkpointLedger ||
		row.objectType !== objectType ||
		row.status !== 'verified'
	) {
		throw promotionError(
			'invalid-source-evidence',
			`Source object ${objectType} is not exact verified checkpoint evidence`
		);
	}
	const content = readRecord(readRecord(row.verificationFacts)?.content);
	if (
		content?.algorithm !== 'sha256' ||
		content.representation !== representation ||
		typeof content.digest !== 'string'
	) {
		throw promotionError(
			'invalid-source-evidence',
			`Source object ${objectType} has no supported content digest`
		);
	}
	try {
		return { contentDigest: FullHistoryHash.fromHex(content.digest), remoteId };
	} catch (error) {
		throw promotionError(
			'invalid-source-evidence',
			`Source object ${objectType} has a malformed content digest`,
			error
		);
	}
}

function readNetworkPassphrase(details: unknown): string {
	const value = readRecord(details)?.networkPassphrase;
	if (typeof value !== 'string') {
		throw promotionError('invalid-proof', 'Proof has no network passphrase');
	}
	return assertBoundedText(value, 'proof.networkPassphrase', 1_024);
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function toDate(value: Date | string, field: string): Date {
	return assertValidDate(new Date(value), field);
}

function promotionError(
	reason: ConstructorParameters<typeof FullHistoryPromotionError>[0],
	message: string,
	cause?: unknown
): FullHistoryPromotionError {
	return new FullHistoryPromotionError(reason, message, { cause });
}
