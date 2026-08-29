import { resolvedContentSourceSql } from '../../database/HistoryArchiveResolvedContentSourceSql.js';
import type { Repository } from 'typeorm';
import type { ParsedTransactionEnvelopeBatchDTO } from 'history-scanner-dto';
import type {
	ParsedTransactionEnvelopeDetails,
	ParsedTransactionEnvelopeObjectObservation,
	ParsedTransactionEnvelopeRepository
} from '../../../domain/parsed-history/ParsedTransactionEnvelopeRepository.js';
import { ParsedTransactionEnvelope } from '../../database/entities/ParsedTransactionEnvelope.js';
import {
	toParsedLedgerSequence,
	toParsedTransactionIndex
} from '../../database/ParsedHistoryInteger.js';
import { saveParsedTransactionEnvelopeBatch } from './ParsedTransactionBatchWrite.js';

interface ParsedTransactionEnvelopeRow {
	readonly envelopeXdr: string;
	readonly lastSourceArchiveUrl: string;
	readonly ledgerSequence: number | string;
	readonly transactionIndex: number | string;
	readonly transactionSetHash: string;
}

export class TypeOrmParsedTransactionEnvelopeRepository implements ParsedTransactionEnvelopeRepository {
	constructor(
		private readonly repository: Repository<ParsedTransactionEnvelope>
	) {}

	async findByLedgerTransaction(
		ledgerSequence: number,
		transactionSetHash: string,
		transactionIndex: number
	): Promise<ParsedTransactionEnvelopeDetails | null> {
		const rows = (await this.repository.query(
			`
				select
					envelope."envelopeXdr",
					coalesce(latest_source."archiveUrl", envelope."lastSourceArchiveUrl")
						as "lastSourceArchiveUrl",
					envelope."ledgerSequence",
					envelope."transactionIndex",
					envelope."transactionSetHash"
				from parsed_transaction_envelope envelope
				left join lateral (
					select source."archiveUrl"
					from parsed_transaction_envelope_observation observation
					left join history_archive_object_queue source
						on source."remoteId" = case
							when observation."sourceObjectRemoteId" ~
								'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
							then observation."sourceObjectRemoteId"::uuid
							else null
						end
					where observation."parsedTransactionEnvelopeId" = envelope.id
					order by observation."observedAt" desc, observation.id desc
					limit 1
				) latest_source on true
				where envelope."ledgerSequence" = $1
					and envelope."transactionSetHash" = $2
					and envelope."transactionIndex" = $3
				limit 1
			`,
			[ledgerSequence, transactionSetHash, transactionIndex]
		)) as ParsedTransactionEnvelopeRow[];
		const row = rows[0];
		if (row === undefined) return null;

		return {
			envelopeXdr: row.envelopeXdr,
			lastSourceArchiveUrl: row.lastSourceArchiveUrl,
			ledgerSequence: toParsedLedgerSequence(row.ledgerSequence),
			transactionIndex: toParsedTransactionIndex(row.transactionIndex),
			transactionSetHash: row.transactionSetHash
		};
	}

	async findBySourceObjectRemoteId(
		sourceObjectRemoteId: string
	): Promise<ParsedTransactionEnvelopeObjectObservation[]> {
		const rows = (await this.repository.query(
			`
				select envelope.*
				from history_archive_object_queue source_object
				join parsed_transaction_envelope envelope
					on envelope."ledgerSequence" between
						greatest(0, source_object."checkpointLedger" - 63)
						and source_object."checkpointLedger"
				where source_object."remoteId" = $1::uuid
					and source_object."objectType" = 'transactions'
					and envelope."lastScanJobRemoteId" =
						${resolvedContentSourceSql(1, 'transactions')}
				order by envelope."ledgerSequence", envelope."transactionIndex"
			`,
			[sourceObjectRemoteId]
		)) as ParsedTransactionEnvelopeRow[];
		return rows.map((row) => ({
			envelopeXdr: row.envelopeXdr,
			ledgerSequence: toParsedLedgerSequence(row.ledgerSequence),
			transactionIndex: toParsedTransactionIndex(row.transactionIndex),
			transactionSetHash: row.transactionSetHash
		}));
	}

	async saveBatch(batch: ParsedTransactionEnvelopeBatchDTO): Promise<void> {
		if (batch.records.length === 0) return;
		await saveParsedTransactionEnvelopeBatch(this.repository.manager, batch);
	}
}
