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
interface ReturnedEnvelopeRow {
	readonly envelopeXdr: string;
	readonly id: number | string;
	readonly ledgerSequence: number | string;
	readonly transactionIndex: number | string;
	readonly transactionSetHash: string;
}

interface ReturnedResultRow {
	readonly id: number | string;
	readonly ledgerSequence: number | string;
	readonly transactionIndex: number | string;
	readonly transactionHash: string;
	readonly transactionResultHash: string;
	readonly resultXdr: string;
}

export async function saveParsedTransactionEnvelopeBatch(
	manager: EntityManager,
	batch: ParsedTransactionEnvelopeBatchDTO
): Promise<void> {
	assertBatchSize(batch.records);
	const records = [...batch.records].sort(compareEnvelopeRecords);
	const identities = records.map(envelopeIdentity);
	assertUniqueIdentities(identities);
	const insert = buildEnvelopeInsert(batch, records);
	const selection = buildEnvelopeSelection(records);

	await manager.transaction(async (transaction) => {
		await transaction.query(
			`
					insert into "parsed_transaction_envelope" (
						"ledgerSequence", "transactionIndex", "transactionSetHash",
					"envelopeXdr", "firstSourceArchiveUrl", "lastSourceArchiveUrl",
					"lastScanJobRemoteId", "firstSeenAt", "lastSeenAt"
				) values ${insert.placeholders}
					on conflict (
						"ledgerSequence", "transactionSetHash", "transactionIndex"
					) do nothing
				`,
			insert.parameters
		);
		const returned = await transaction.query<ReturnedEnvelopeRow[]>(
			selection.sql,
			selection.parameters
		);
		assertReturnedIdentities(identities, returned.map(toEnvelopeIdentity));
		assertEnvelopeValues(records, returned);
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
	const records = [...batch.records].sort(compareResultRecords);
	const identities = records.map(resultIdentity);
	assertUniqueIdentities(identities);
	const insert = buildResultInsert(batch, records);
	const selection = buildResultSelection(records);

	await manager.transaction(async (transaction) => {
		await transaction.query(
			`
					insert into "parsed_transaction_result" (
					"ledgerSequence", "transactionIndex", "transactionResultHash",
					"transactionHash", "resultXdr", "firstSourceArchiveUrl",
					"lastSourceArchiveUrl", "lastScanJobRemoteId", "firstSeenAt",
					"lastSeenAt"
				) values ${insert.placeholders}
					on conflict (
						"ledgerSequence", "transactionResultHash", "transactionIndex"
					) do nothing
				`,
			insert.parameters
		);
		const returned = await transaction.query<ReturnedResultRow[]>(
			selection.sql,
			selection.parameters
		);
		assertReturnedIdentities(identities, returned.map(toResultIdentity));
		assertResultValues(records, returned);
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

function buildEnvelopeInsert(
	batch: ParsedTransactionEnvelopeBatchDTO,
	records: readonly ParsedTransactionEnvelopeDTO[]
): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	return buildInsert(
		records.map((record) => [
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

function buildResultInsert(
	batch: ParsedTransactionResultBatchDTO,
	records: readonly ParsedTransactionResultDTO[]
): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	return buildInsert(
		records.map((record) => [
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

function buildEnvelopeSelection(
	records: readonly ParsedTransactionEnvelopeDTO[]
): ParameterizedQuery {
	return buildSelection(
		'parsed_transaction_envelope',
		['ledgerSequence', 'transactionSetHash', 'transactionIndex', 'envelopeXdr'],
		['bigint', 'text', 'integer', 'text'],
		records.map((record) => [
			record.ledgerSequence,
			record.transactionSetHash,
			record.transactionIndex,
			record.envelopeXdr
		]),
		['ledgerSequence', 'transactionSetHash', 'transactionIndex'],
		[
			'id',
			'ledgerSequence',
			'transactionSetHash',
			'transactionIndex',
			'envelopeXdr'
		]
	);
}

function buildResultSelection(
	records: readonly ParsedTransactionResultDTO[]
): ParameterizedQuery {
	return buildSelection(
		'parsed_transaction_result',
		[
			'ledgerSequence',
			'transactionResultHash',
			'transactionIndex',
			'transactionHash',
			'resultXdr'
		],
		['bigint', 'text', 'integer', 'text', 'text'],
		records.map((record) => [
			record.ledgerSequence,
			record.transactionResultHash,
			record.transactionIndex,
			record.transactionHash,
			record.resultXdr
		]),
		['ledgerSequence', 'transactionResultHash', 'transactionIndex'],
		[
			'id',
			'ledgerSequence',
			'transactionResultHash',
			'transactionIndex',
			'transactionHash',
			'resultXdr'
		]
	);
}

interface ParameterizedQuery {
	readonly parameters: unknown[];
	readonly sql: string;
}

function buildSelection(
	table: string,
	inputColumns: readonly string[],
	inputTypes: readonly PostgresInputType[],
	valuesByRow: readonly (readonly unknown[])[],
	identityColumns: readonly string[],
	selectedColumns: readonly string[]
): ParameterizedQuery {
	const input = buildInsert(valuesByRow, inputTypes);
	const columns = inputColumns.map(quoteIdentifier).join(', ');
	const identityJoin = identityColumns
		.map(
			(column) =>
				`stored.${quoteIdentifier(column)} = input.${quoteIdentifier(column)}`
		)
		.join(' and ');
	return {
		parameters: input.parameters,
		sql: `
			select ${selectedColumns
				.map((column) => `stored.${quoteIdentifier(column)}`)
				.join(', ')}
			from (values ${input.placeholders}) as input (${columns})
			join ${quoteIdentifier(table)} stored on ${identityJoin}
			order by ${identityColumns
				.map((column) => `input.${quoteIdentifier(column)}`)
				.join(', ')}
		`
	};
}

type PostgresInputType = 'bigint' | 'integer' | 'text';

function buildInsert(
	valuesByRow: readonly (readonly unknown[])[],
	parameterTypes?: readonly PostgresInputType[]
): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	const parameters: unknown[] = [];
	return {
		parameters,
		placeholders: valuesByRow
			.map(
				(values) =>
					`(${values
						.map((value, index) => {
							const placeholder = `$${parameters.push(value)}`;
							const type = parameterTypes?.[index];
							return type === undefined
								? placeholder
								: `${placeholder}::${type}`;
						})
						.join(', ')})`
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

function assertEnvelopeValues(
	records: readonly ParsedTransactionEnvelopeDTO[],
	returned: readonly ReturnedEnvelopeRow[]
): void {
	const expected = new Map(
		records.map((record) => [
			identityKey(envelopeIdentity(record)),
			record.envelopeXdr
		])
	);
	const conflicts = returned
		.filter(
			(row) =>
				expected.get(identityKey(toEnvelopeIdentity(row))) !== row.envelopeXdr
		)
		.map(toEnvelopeIdentity);
	if (conflicts.length > 0) {
		throw new ParsedTransactionConflictError(
			'stored-value-conflict',
			conflicts
		);
	}
}

function assertResultValues(
	records: readonly ParsedTransactionResultDTO[],
	returned: readonly ReturnedResultRow[]
): void {
	const expected = new Map(
		records.map((record) => [
			identityKey(resultIdentity(record)),
			[record.transactionHash, record.resultXdr] as const
		])
	);
	const conflicts = returned
		.filter((row) => {
			const value = expected.get(identityKey(toResultIdentity(row)));
			return (
				value === undefined ||
				value[0] !== row.transactionHash ||
				value[1] !== row.resultXdr
			);
		})
		.map(toResultIdentity);
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

function compareEnvelopeRecords(
	left: ParsedTransactionEnvelopeDTO,
	right: ParsedTransactionEnvelopeDTO
): number {
	return compareIdentities(envelopeIdentity(left), envelopeIdentity(right));
}

function compareResultRecords(
	left: ParsedTransactionResultDTO,
	right: ParsedTransactionResultDTO
): number {
	return compareIdentities(resultIdentity(left), resultIdentity(right));
}

function compareIdentities(
	left: ParsedTransactionIdentity,
	right: ParsedTransactionIdentity
): number {
	return (
		left.ledgerSequence - right.ledgerSequence ||
		left.categoryHash.localeCompare(right.categoryHash) ||
		left.transactionIndex - right.transactionIndex
	);
}

function quoteIdentifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}
