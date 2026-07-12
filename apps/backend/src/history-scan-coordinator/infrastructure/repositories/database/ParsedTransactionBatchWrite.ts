import type { EntityManager } from 'typeorm';
import type {
	ParsedTransactionEnvelopeBatchDTO,
	ParsedTransactionEnvelopeDTO,
	ParsedTransactionResultBatchDTO,
	ParsedTransactionResultDTO
} from 'history-scanner-dto';
import {
	ParsedTransactionConflictError,
	type ParsedTransactionIdentity
} from '../../../domain/parsed-history/ParsedTransactionConflictError.js';
import { recordTransactionObservations } from './ParsedHistoryObservationWrite.js';

const maximumBatchSize = 1_000;
const maximumLedgerSequence = 0xffff_ffff;
const maximumTransactionIndex = 0x7fff_ffff;
const latestObservationCondition = `(
	excluded."lastSeenAt" > stored."lastSeenAt"
	or (
		excluded."lastSeenAt" = stored."lastSeenAt"
		and (excluded."lastSourceArchiveUrl", excluded."lastScanJobRemoteId") >
			(stored."lastSourceArchiveUrl", stored."lastScanJobRemoteId")
	)
)`;

interface ReturnedEnvelopeRow {
	readonly id: number | string;
	readonly ledgerSequence: number | string;
	readonly transactionIndex: number | string;
	readonly transactionSetHash: string;
}

interface ReturnedResultRow {
	readonly id: number | string;
	readonly ledgerSequence: number | string;
	readonly transactionIndex: number | string;
	readonly transactionResultHash: string;
}

export async function saveParsedTransactionEnvelopeBatch(
	manager: EntityManager,
	batch: ParsedTransactionEnvelopeBatchDTO
): Promise<void> {
	assertBatchSize(batch.records);
	const identities = batch.records.map(envelopeIdentity);
	assertUniqueIdentities(identities);
	const insert = buildEnvelopeInsert(batch);

	await manager.transaction(async (transaction) => {
		const returned = await transaction.query<ReturnedEnvelopeRow[]>(
			`
				insert into "parsed_transaction_envelope" as stored (
					"ledgerSequence", "transactionIndex", "transactionSetHash",
					"envelopeXdr", "firstSourceArchiveUrl", "lastSourceArchiveUrl",
					"lastScanJobRemoteId", "firstSeenAt", "lastSeenAt"
				) values ${insert.placeholders}
				on conflict (
					"ledgerSequence", "transactionSetHash", "transactionIndex"
				) do update set
					"firstSourceArchiveUrl" = case
						when excluded."firstSeenAt" < stored."firstSeenAt"
							or (
								excluded."firstSeenAt" = stored."firstSeenAt"
								and excluded."firstSourceArchiveUrl" <
									stored."firstSourceArchiveUrl"
							)
						then excluded."firstSourceArchiveUrl"
						else stored."firstSourceArchiveUrl"
					end,
					"firstSeenAt" = least(stored."firstSeenAt", excluded."firstSeenAt"),
					"lastSourceArchiveUrl" = case
						when ${latestObservationCondition}
						then excluded."lastSourceArchiveUrl"
						else stored."lastSourceArchiveUrl"
					end,
					"lastScanJobRemoteId" = case
						when ${latestObservationCondition}
						then excluded."lastScanJobRemoteId"
						else stored."lastScanJobRemoteId"
					end,
					"lastSeenAt" = greatest(stored."lastSeenAt", excluded."lastSeenAt")
				where excluded."envelopeXdr" = stored."envelopeXdr"
				returning "id", "ledgerSequence", "transactionSetHash", "transactionIndex"
			`,
			insert.parameters
		);
		assertReturnedIdentities(identities, returned.map(toEnvelopeIdentity));
		await recordTransactionObservations(
			transaction,
			batch.scanJobRemoteId,
			batch.observedAt,
			'parsed_transaction_envelope_observation',
			'parsedTransactionEnvelopeId',
			returned.map((row) => toRowId(row.id))
		);
	});
}

export async function saveParsedTransactionResultBatch(
	manager: EntityManager,
	batch: ParsedTransactionResultBatchDTO
): Promise<void> {
	assertBatchSize(batch.records);
	const identities = batch.records.map(resultIdentity);
	assertUniqueIdentities(identities);
	const insert = buildResultInsert(batch);

	await manager.transaction(async (transaction) => {
		const returned = await transaction.query<ReturnedResultRow[]>(
			`
				insert into "parsed_transaction_result" as stored (
					"ledgerSequence", "transactionIndex", "transactionResultHash",
					"transactionHash", "resultXdr", "firstSourceArchiveUrl",
					"lastSourceArchiveUrl", "lastScanJobRemoteId", "firstSeenAt",
					"lastSeenAt"
				) values ${insert.placeholders}
				on conflict (
					"ledgerSequence", "transactionResultHash", "transactionIndex"
				) do update set
					"firstSourceArchiveUrl" = case
						when excluded."firstSeenAt" < stored."firstSeenAt"
							or (
								excluded."firstSeenAt" = stored."firstSeenAt"
								and excluded."firstSourceArchiveUrl" <
									stored."firstSourceArchiveUrl"
							)
						then excluded."firstSourceArchiveUrl"
						else stored."firstSourceArchiveUrl"
					end,
					"firstSeenAt" = least(stored."firstSeenAt", excluded."firstSeenAt"),
					"lastSourceArchiveUrl" = case
						when ${latestObservationCondition}
						then excluded."lastSourceArchiveUrl"
						else stored."lastSourceArchiveUrl"
					end,
					"lastScanJobRemoteId" = case
						when ${latestObservationCondition}
						then excluded."lastScanJobRemoteId"
						else stored."lastScanJobRemoteId"
					end,
					"lastSeenAt" = greatest(stored."lastSeenAt", excluded."lastSeenAt")
				where excluded."transactionHash" = stored."transactionHash"
					and excluded."resultXdr" = stored."resultXdr"
				returning "id", "ledgerSequence", "transactionResultHash", "transactionIndex"
			`,
			insert.parameters
		);
		assertReturnedIdentities(identities, returned.map(toResultIdentity));
		await recordTransactionObservations(
			transaction,
			batch.scanJobRemoteId,
			batch.observedAt,
			'parsed_transaction_result_observation',
			'parsedTransactionResultId',
			returned.map((row) => toRowId(row.id))
		);
	});
}

function buildEnvelopeInsert(batch: ParsedTransactionEnvelopeBatchDTO): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	return buildInsert(
		batch.records.map((record) => [
			record.ledgerSequence,
			record.transactionIndex,
			record.transactionSetHash,
			record.envelopeXdr,
			batch.sourceArchiveUrl,
			batch.sourceArchiveUrl,
			batch.scanJobRemoteId,
			batch.observedAt,
			batch.observedAt
		])
	);
}

function buildResultInsert(batch: ParsedTransactionResultBatchDTO): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	return buildInsert(
		batch.records.map((record) => [
			record.ledgerSequence,
			record.transactionIndex,
			record.transactionResultHash,
			record.transactionHash,
			record.resultXdr,
			batch.sourceArchiveUrl,
			batch.sourceArchiveUrl,
			batch.scanJobRemoteId,
			batch.observedAt,
			batch.observedAt
		])
	);
}

function buildInsert(valuesByRow: readonly (readonly unknown[])[]): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	const parameters: unknown[] = [];
	return {
		parameters,
		placeholders: valuesByRow
			.map(
				(values) =>
					`(${values.map((value) => `$${parameters.push(value)}`).join(', ')})`
			)
			.join(',\n')
	};
}

function assertBatchSize(records: readonly unknown[]): void {
	if (records.length === 0 || records.length > maximumBatchSize) {
		throw new RangeError(
			`Parsed transaction batch size must be between 1 and ${maximumBatchSize}`
		);
	}
}

function assertUniqueIdentities(
	identities: readonly ParsedTransactionIdentity[]
): void {
	const keys = new Set<string>();
	for (const identity of identities) {
		assertIdentityBounds(identity);
		const key = identityKey(identity);
		if (keys.has(key)) {
			throw new ParsedTransactionConflictError('duplicate-batch-identity', [
				identity
			]);
		}
		keys.add(key);
	}
}

function assertReturnedIdentities(
	requested: readonly ParsedTransactionIdentity[],
	returned: readonly ParsedTransactionIdentity[]
): void {
	const returnedKeys = new Set(returned.map(identityKey));
	const conflicts = requested.filter(
		(identity) => !returnedKeys.has(identityKey(identity))
	);
	if (conflicts.length > 0) {
		throw new ParsedTransactionConflictError(
			'stored-value-conflict',
			conflicts
		);
	}
}

function envelopeIdentity(
	record: ParsedTransactionEnvelopeDTO
): ParsedTransactionIdentity {
	return {
		category: 'envelope',
		categoryHash: record.transactionSetHash,
		ledgerSequence: record.ledgerSequence,
		transactionIndex: record.transactionIndex
	};
}

function resultIdentity(
	record: ParsedTransactionResultDTO
): ParsedTransactionIdentity {
	return {
		category: 'result',
		categoryHash: record.transactionResultHash,
		ledgerSequence: record.ledgerSequence,
		transactionIndex: record.transactionIndex
	};
}

function toEnvelopeIdentity(
	row: ReturnedEnvelopeRow
): ParsedTransactionIdentity {
	return envelopeIdentity({
		envelopeXdr: '',
		ledgerSequence: toInteger(row.ledgerSequence, maximumLedgerSequence),
		transactionIndex: toInteger(row.transactionIndex, maximumTransactionIndex),
		transactionSetHash: row.transactionSetHash
	});
}

function toResultIdentity(row: ReturnedResultRow): ParsedTransactionIdentity {
	return resultIdentity({
		ledgerSequence: toInteger(row.ledgerSequence, maximumLedgerSequence),
		resultXdr: '',
		transactionHash: '',
		transactionIndex: toInteger(row.transactionIndex, maximumTransactionIndex),
		transactionResultHash: row.transactionResultHash
	});
}

function assertIdentityBounds(identity: ParsedTransactionIdentity): void {
	toInteger(identity.ledgerSequence, maximumLedgerSequence);
	toInteger(identity.transactionIndex, maximumTransactionIndex);
	if (identity.categoryHash.trim().length === 0) {
		throw new Error('Parsed transaction category hash must not be empty');
	}
}

function toRowId(value: number | string): number {
	return toInteger(value, 0x7fff_ffff);
}

function toInteger(value: number | string, maximum: number): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
		throw new RangeError(
			'Parsed transaction integer is outside its supported range'
		);
	}
	return parsed;
}

function identityKey(identity: ParsedTransactionIdentity): string {
	return JSON.stringify([
		identity.category,
		identity.ledgerSequence,
		identity.categoryHash,
		identity.transactionIndex
	]);
}
