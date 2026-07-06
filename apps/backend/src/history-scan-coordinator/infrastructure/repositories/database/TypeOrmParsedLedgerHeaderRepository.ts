import type { Repository } from 'typeorm';
import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import type {
	ParsedLedgerHeaderRepository,
	ParsedLedgerHeaderWatermark
} from '../../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { ParsedLedgerHeader } from '../../database/entities/ParsedLedgerHeader.js';

interface ParsedLedgerHeaderWatermarkRow {
	readonly parsedLedgerCount: string | null;
	readonly sourceArchiveCount: string | null;
}

export class TypeOrmParsedLedgerHeaderRepository implements ParsedLedgerHeaderRepository {
	constructor(private readonly repository: Repository<ParsedLedgerHeader>) {}

	async getWatermark(): Promise<ParsedLedgerHeaderWatermark> {
		const [countRows, sourceRows, earliest, latest] = await Promise.all([
			this.repository.query(`
				select greatest(
					coalesce(nullif(stat.n_live_tup, 0), class.reltuples)::bigint,
					0
				) as "parsedLedgerCount"
				from pg_class class
				left join pg_stat_all_tables stat on stat.relid = class.oid
				where class.oid = 'parsed_ledger_header'::regclass
			`) as Promise<ParsedLedgerHeaderWatermarkRow[]>,
			this.repository.query(`
				select count(distinct url) as "sourceArchiveCount"
				from history_archive_scan_v2
			`) as Promise<ParsedLedgerHeaderWatermarkRow[]>,
			this.repository
				.find({
					order: { ledgerSequence: 'ASC' },
					select: { ledgerSequence: true },
					take: 1
				})
				.then((rows) => rows[0] ?? null),
			this.repository
				.find({
					order: { ledgerSequence: 'DESC', lastSeenAt: 'DESC' },
					select: {
						lastSeenAt: true,
						ledgerHeaderHash: true,
						ledgerSequence: true
					},
					take: 1
				})
				.then((rows) => rows[0] ?? null)
		]);

		return {
			earliestLedgerSequence: earliest?.ledgerSequence ?? null,
			latestLedgerHeaderHash: latest?.ledgerHeaderHash ?? null,
			latestLedgerSequence: latest?.ledgerSequence ?? null,
			latestObservedAt: latest?.lastSeenAt ?? null,
			parsedLedgerCount: toNumber(countRows[0]?.parsedLedgerCount),
			sourceArchiveCount: toNumber(sourceRows[0]?.sourceArchiveCount)
		};
	}

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

function toNumber(value: string | null | undefined): number {
	return value === undefined || value === null ? 0 : Number(value);
}
