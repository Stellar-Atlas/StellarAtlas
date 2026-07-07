import type { Repository } from 'typeorm';
import type { ParsedTransactionEnvelopeBatchDTO } from 'history-scanner-dto';
import type {
	ParsedTransactionEnvelopeDetails,
	ParsedTransactionEnvelopeRepository
} from '../../../domain/parsed-history/ParsedTransactionEnvelopeRepository.js';
import { ParsedTransactionEnvelope } from '../../database/entities/ParsedTransactionEnvelope.js';

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

	async saveBatch(batch: ParsedTransactionEnvelopeBatchDTO): Promise<void> {
		if (batch.records.length === 0) return;

		const rows = batch.records.map(
			(record) =>
				new ParsedTransactionEnvelope(
					record,
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt
				)
		);

		await this.repository
			.createQueryBuilder()
			.insert()
			.into(ParsedTransactionEnvelope)
			.values(rows)
			.orUpdate(
				['lastSourceArchiveUrl', 'lastScanJobRemoteId', 'lastSeenAt'],
				['ledgerSequence', 'transactionSetHash', 'transactionIndex'],
				{ skipUpdateIfNoValuesChanged: true }
			)
			.execute();
	}
}
