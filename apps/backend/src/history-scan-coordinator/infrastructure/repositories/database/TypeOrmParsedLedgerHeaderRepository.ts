import type { Repository } from 'typeorm';
import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import type { ParsedLedgerHeaderRepository } from '../../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { ParsedLedgerHeader } from '../../database/entities/ParsedLedgerHeader.js';

export class TypeOrmParsedLedgerHeaderRepository
	implements ParsedLedgerHeaderRepository
{
	constructor(private readonly repository: Repository<ParsedLedgerHeader>) {}

	async saveBatch(batch: ParsedLedgerHeaderBatchDTO): Promise<void> {
		if (batch.headers.length === 0) return;

		const rows = batch.headers.map(
			(header) =>
				new ParsedLedgerHeader(
					header,
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt
				)
		);

		await this.repository
			.createQueryBuilder()
			.insert()
			.into(ParsedLedgerHeader)
			.values(rows)
			.orUpdate(
				['lastSourceArchiveUrl', 'lastScanJobRemoteId', 'lastSeenAt'],
				['ledgerSequence', 'ledgerHeaderHash'],
				{ skipUpdateIfNoValuesChanged: true }
			)
			.execute();
	}
}
