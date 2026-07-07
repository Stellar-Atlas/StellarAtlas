import type { Repository } from 'typeorm';
import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import type {
	ParsedLedgerHeaderDetails,
	ParsedLedgerHeaderRepository,
	ParsedLedgerHeaderSourceRange,
	ParsedLedgerHeaderWatermark
} from '../../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { ParsedLedgerHeader } from '../../database/entities/ParsedLedgerHeader.js';

interface ParsedLedgerHeaderWatermarkRow {
	readonly parsedLedgerCount: string | null;
	readonly sourceArchiveCount: string | null;
}

interface ParsedLedgerHeaderSourceRangeRow {
	readonly archiveUrl: string;
	readonly earliestLedgerSequence: string | number;
	readonly latestLedgerSequence: string | number;
	readonly latestObservedAt: Date | string;
	readonly parsedLedgerCount: string | number;
}

export class TypeOrmParsedLedgerHeaderRepository implements ParsedLedgerHeaderRepository {
	constructor(private readonly repository: Repository<ParsedLedgerHeader>) {}

	async findByLedgerSequence(
		ledgerSequence: number
	): Promise<ParsedLedgerHeaderDetails | null> {
		const rows = await this.repository.find({
			order: { lastSeenAt: 'DESC' },
			select: {
				bucketListHash: true,
				lastSourceArchiveUrl: true,
				ledgerHeaderHash: true,
				protocolVersion: true,
				transactionResultHash: true,
				transactionSetHash: true
			},
			take: 1,
			where: { ledgerSequence }
		});
		const row = rows[0];
		if (row === undefined) return null;

		return {
			bucketListHash: row.bucketListHash,
			lastSourceArchiveUrl: row.lastSourceArchiveUrl,
			ledgerHeaderHash: row.ledgerHeaderHash,
			protocolVersion: row.protocolVersion,
			transactionResultHash: row.transactionResultHash,
			transactionSetHash: row.transactionSetHash
		};
	}

	async findSourceRanges(
		limit: number
	): Promise<ParsedLedgerHeaderSourceRange[]> {
		const rows = (await this.repository.query(
			`
				select
					"lastSourceArchiveUrl" as "archiveUrl",
					count(*) as "parsedLedgerCount",
					min("ledgerSequence") as "earliestLedgerSequence",
					max("ledgerSequence") as "latestLedgerSequence",
					max("lastSeenAt") as "latestObservedAt"
				from parsed_ledger_header
				group by "lastSourceArchiveUrl"
				order by max("lastSeenAt") desc
				limit $1
			`,
			[limit]
		)) as ParsedLedgerHeaderSourceRangeRow[];

		return rows.map((row) => ({
			archiveUrl: row.archiveUrl,
			earliestLedgerSequence: toNumber(row.earliestLedgerSequence),
			latestLedgerSequence: toNumber(row.latestLedgerSequence),
			latestObservedAt: toDate(row.latestObservedAt),
			parsedLedgerCount: toNumber(row.parsedLedgerCount)
		}));
	}

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
				select count(distinct "lastSourceArchiveUrl") as "sourceArchiveCount"
				from parsed_ledger_header
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

function toNumber(value: number | string | null | undefined): number {
	if (typeof value === 'number') return value;
	return value === undefined || value === null ? 0 : Number(value);
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}
