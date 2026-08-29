import { resolvedContentSourceSql } from '../../database/HistoryArchiveResolvedContentSourceSql.js';
import type { Repository } from 'typeorm';
import type { ParsedTransactionResultBatchDTO } from 'history-scanner-dto';
import type {
	ParsedRecentTransactionDetails,
	ParsedTransactionResultDetails,
	ParsedTransactionResultObjectObservation,
	ParsedTransactionResultRepository
} from '../../../domain/parsed-history/ParsedTransactionResultRepository.js';
import { ParsedTransactionResult } from '../../database/entities/ParsedTransactionResult.js';
import {
	toParsedLedgerSequence,
	toParsedTransactionIndex
} from '../../database/ParsedHistoryInteger.js';
import { saveParsedTransactionResultBatch } from './ParsedTransactionBatchWrite.js';

interface ParsedRecentTransactionRow {
	readonly envelopeObservedAt: Date | string | null;
	readonly envelopeSourceArchiveUrl: string | null;
	readonly headerObservedAt: Date | string | null;
	readonly headerSourceArchiveUrl: string | null;
	readonly ledgerHeaderHash: string | null;
	readonly ledgerSequence: number | string;
	readonly protocolVersion: number | string | null;
	readonly resultObservedAt: Date | string;
	readonly resultSourceArchiveUrl: string;
	readonly transactionHash: string;
	readonly transactionIndex: number | string;
	readonly transactionResultHash: string;
	readonly transactionSetHash: string | null;
}

interface ParsedTransactionResultRow {
	readonly ledgerSequence: number | string;
	readonly resultXdr: string;
	readonly transactionHash: string;
	readonly transactionIndex: number | string;
	readonly transactionResultHash: string;
}

export class TypeOrmParsedTransactionResultRepository implements ParsedTransactionResultRepository {
	constructor(
		private readonly repository: Repository<ParsedTransactionResult>
	) {}

	async findByTransactionHash(
		transactionHash: string
	): Promise<ParsedTransactionResultDetails | null> {
		const rows = (await this.repository.query(
			`
				select
					result."ledgerSequence",
					result."resultXdr",
					result."transactionHash",
					result."transactionIndex",
					result."transactionResultHash",
					coalesce(latest_source."archiveUrl", result."lastSourceArchiveUrl")
						as "lastSourceArchiveUrl"
				from parsed_transaction_result result
				left join lateral (
					select source."archiveUrl", observation."observedAt"
					from parsed_transaction_result_observation observation
					left join history_archive_object_queue source
						on source."remoteId" = case
							when observation."sourceObjectRemoteId" ~
								'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
							then observation."sourceObjectRemoteId"::uuid
							else null
						end
					where observation."parsedTransactionResultId" = result.id
					order by observation."observedAt" desc, observation.id desc
					limit 1
				) latest_source on true
				where result."transactionHash" = $1
				order by coalesce(latest_source."observedAt", result."lastSeenAt") desc,
					result.id desc
				limit 1
			`,
			[transactionHash]
		)) as (ParsedTransactionResultRow & {
			readonly lastSourceArchiveUrl: string;
		})[];
		const row = rows[0];
		if (row === undefined) return null;

		return {
			lastSourceArchiveUrl: row.lastSourceArchiveUrl,
			ledgerSequence: toParsedLedgerSequence(row.ledgerSequence),
			resultXdr: row.resultXdr,
			transactionHash: row.transactionHash,
			transactionIndex: toParsedTransactionIndex(row.transactionIndex),
			transactionResultHash: row.transactionResultHash
		};
	}

	async findBySourceObjectRemoteId(
		sourceObjectRemoteId: string
	): Promise<ParsedTransactionResultObjectObservation[]> {
		const rows = (await this.repository.query(
			`
				select result.*
				from history_archive_object_queue source_object
				join parsed_transaction_result result
					on result."ledgerSequence" between
						greatest(0, source_object."checkpointLedger" - 63)
						and source_object."checkpointLedger"
				where source_object."remoteId" = $1::uuid
					and source_object."objectType" = 'results'
					and result."lastScanJobRemoteId" =
						${resolvedContentSourceSql(1, 'results')}
				order by result."ledgerSequence", result."transactionIndex"
			`,
			[sourceObjectRemoteId]
		)) as ParsedTransactionResultRow[];
		return rows.map((row) => ({
			ledgerSequence: toParsedLedgerSequence(row.ledgerSequence),
			resultXdr: row.resultXdr,
			transactionHash: row.transactionHash,
			transactionIndex: toParsedTransactionIndex(row.transactionIndex),
			transactionResultHash: row.transactionResultHash
		}));
	}

	async findRecentWithLedgerContext(
		limit: number
	): Promise<ParsedRecentTransactionDetails[]> {
		const rows = (await this.repository.query(
			`
				select
					tx_result."ledgerSequence" as "ledgerSequence",
					tx_result."transactionIndex" as "transactionIndex",
					tx_result."transactionHash" as "transactionHash",
					tx_result."transactionResultHash" as "transactionResultHash",
					coalesce(result_source."archiveUrl", tx_result."lastSourceArchiveUrl")
						as "resultSourceArchiveUrl",
					coalesce(result_source."observedAt", tx_result."lastSeenAt")
						as "resultObservedAt",
					header."ledgerHeaderHash" as "ledgerHeaderHash",
					header."transactionSetHash" as "transactionSetHash",
					header."protocolVersion" as "protocolVersion",
					header."lastSourceArchiveUrl" as "headerSourceArchiveUrl",
					header."lastSeenAt" as "headerObservedAt",
					envelope."lastSourceArchiveUrl" as "envelopeSourceArchiveUrl",
					envelope."lastSeenAt" as "envelopeObservedAt"
				from parsed_transaction_result tx_result
				left join lateral (
					select source."archiveUrl", observation."observedAt"
					from parsed_transaction_result_observation observation
					left join history_archive_object_queue source
						on source."remoteId" = case
							when observation."sourceObjectRemoteId" ~
								'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
							then observation."sourceObjectRemoteId"::uuid
							else null
						end
					where observation."parsedTransactionResultId" = tx_result.id
					order by observation."observedAt" desc, observation.id desc
					limit 1
				) result_source on true
				left join lateral (
					select
						"ledgerHeaderHash",
						"transactionSetHash",
						"protocolVersion",
						"lastSourceArchiveUrl",
						"lastSeenAt"
					from parsed_ledger_header header_row
					where header_row."ledgerSequence" = tx_result."ledgerSequence"
						and header_row."transactionResultHash" =
							tx_result."transactionResultHash"
					order by header_row."lastSeenAt" desc, header_row.id desc
					limit 1
				) header on true
				left join lateral (
					select
						coalesce(envelope_source."archiveUrl", envelope_row."lastSourceArchiveUrl")
							as "lastSourceArchiveUrl",
						coalesce(envelope_source."observedAt", envelope_row."lastSeenAt")
							as "lastSeenAt"
					from parsed_transaction_envelope envelope_row
					left join lateral (
						select source."archiveUrl", observation."observedAt"
						from parsed_transaction_envelope_observation observation
						left join history_archive_object_queue source
							on source."remoteId" = case
								when observation."sourceObjectRemoteId" ~
									'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
								then observation."sourceObjectRemoteId"::uuid
								else null
							end
						where observation."parsedTransactionEnvelopeId" = envelope_row.id
						order by observation."observedAt" desc, observation.id desc
						limit 1
					) envelope_source on true
					where envelope_row."ledgerSequence" = tx_result."ledgerSequence"
						and envelope_row."transactionSetHash" = header."transactionSetHash"
						and envelope_row."transactionIndex" = tx_result."transactionIndex"
					order by coalesce(
						envelope_source."observedAt",
						envelope_row."lastSeenAt"
					) desc, envelope_row.id desc
					limit 1
				) envelope on true
				order by
					tx_result."ledgerSequence" desc,
					tx_result."transactionIndex" desc,
					coalesce(result_source."observedAt", tx_result."lastSeenAt") desc
				limit $1
			`,
			[limit]
		)) as ParsedRecentTransactionRow[];

		return rows.map((row) => ({
			envelopeObservedAt: toNullableDate(row.envelopeObservedAt),
			envelopeSourceArchiveUrl: row.envelopeSourceArchiveUrl,
			headerObservedAt: toNullableDate(row.headerObservedAt),
			headerSourceArchiveUrl: row.headerSourceArchiveUrl,
			ledgerHeaderHash: row.ledgerHeaderHash,
			ledgerSequence: toParsedLedgerSequence(row.ledgerSequence),
			protocolVersion: toNullableProtocolVersion(row.protocolVersion),
			resultObservedAt: toDate(row.resultObservedAt),
			resultSourceArchiveUrl: row.resultSourceArchiveUrl,
			transactionHash: row.transactionHash,
			transactionIndex: toParsedTransactionIndex(row.transactionIndex),
			transactionResultHash: row.transactionResultHash,
			transactionSetHash: row.transactionSetHash
		}));
	}

	async saveBatch(batch: ParsedTransactionResultBatchDTO): Promise<void> {
		if (batch.records.length === 0) return;
		await saveParsedTransactionResultBatch(this.repository.manager, batch);
	}
}

function toNullableProtocolVersion(
	value: number | string | null
): number | null {
	if (value === null) return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0x7fff_ffff) {
		throw new RangeError(
			'protocolVersion is outside its supported integer range'
		);
	}
	return parsed;
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function toNullableDate(value: Date | string | null): Date | null {
	return value === null ? null : toDate(value);
}
