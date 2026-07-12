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
		const rows = await this.repository.find({
			order: { lastSeenAt: 'DESC' },
			select: {
				envelopeXdr: true,
				lastSourceArchiveUrl: true,
				ledgerSequence: true,
				transactionIndex: true,
				transactionSetHash: true
			},
			take: 1,
			where: {
				ledgerSequence,
				transactionIndex,
				transactionSetHash
			}
		});
		const row = rows[0];
		if (row === undefined) return null;

		return {
			envelopeXdr: row.envelopeXdr,
			lastSourceArchiveUrl: row.lastSourceArchiveUrl,
			ledgerSequence: row.ledgerSequence,
			transactionIndex: row.transactionIndex,
			transactionSetHash: row.transactionSetHash
		};
	}

	async findBySourceObjectRemoteId(
		sourceObjectRemoteId: string
	): Promise<ParsedTransactionEnvelopeObjectObservation[]> {
		const rows = (await this.repository.query(
			`
				select envelope.*
				from parsed_transaction_envelope_observation observation
				join parsed_transaction_envelope envelope
					on envelope.id = observation."parsedTransactionEnvelopeId"
				where observation."sourceObjectRemoteId" = $1
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
