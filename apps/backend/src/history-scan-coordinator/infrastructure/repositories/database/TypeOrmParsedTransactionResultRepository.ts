import type { Repository } from 'typeorm';
import type { ParsedTransactionResultBatchDTO } from 'history-scanner-dto';
import type {
	ParsedTransactionResultDetails,
	ParsedTransactionResultRepository
} from '../../../domain/parsed-history/ParsedTransactionResultRepository.js';
import { ParsedTransactionResult } from '../../database/entities/ParsedTransactionResult.js';

export class TypeOrmParsedTransactionResultRepository implements ParsedTransactionResultRepository {
	constructor(
		private readonly repository: Repository<ParsedTransactionResult>
	) {}

	async findByTransactionHash(
		transactionHash: string
	): Promise<ParsedTransactionResultDetails | null> {
		const rows = await this.repository.find({
			order: { lastSeenAt: 'DESC' },
			select: {
				lastSourceArchiveUrl: true,
				ledgerSequence: true,
				resultXdr: true,
				transactionHash: true,
				transactionIndex: true,
				transactionResultHash: true
			},
			take: 1,
			where: { transactionHash }
		});
		const row = rows[0];
		if (row === undefined) return null;

		return {
			lastSourceArchiveUrl: row.lastSourceArchiveUrl,
			ledgerSequence: row.ledgerSequence,
			resultXdr: row.resultXdr,
			transactionHash: row.transactionHash,
			transactionIndex: row.transactionIndex,
			transactionResultHash: row.transactionResultHash
		};
	}

	async saveBatch(batch: ParsedTransactionResultBatchDTO): Promise<void> {
		if (batch.records.length === 0) return;

		const rows = batch.records.map(
			(record) =>
				new ParsedTransactionResult(
					record,
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt
				)
		);

		await this.repository
			.createQueryBuilder()
			.insert()
			.into(ParsedTransactionResult)
			.values(rows)
			.orUpdate(
				['lastSourceArchiveUrl', 'lastScanJobRemoteId', 'lastSeenAt'],
				['ledgerSequence', 'transactionResultHash', 'transactionIndex'],
				{ skipUpdateIfNoValuesChanged: true }
			)
			.execute();
	}
}
