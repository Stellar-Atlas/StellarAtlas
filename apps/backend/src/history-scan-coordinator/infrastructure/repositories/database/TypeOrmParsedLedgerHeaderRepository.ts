import type { Repository } from 'typeorm';
import type { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';
import {
	ParsedLedgerHeaderConflictError,
	type ParsedLedgerHeaderIdentity
} from '../../../domain/parsed-history/ParsedLedgerHeaderConflictError.js';
import type {
	ParsedLedgerHeaderDetails,
	ParsedLedgerHeaderObjectObservation,
	ParsedLedgerHeaderRepository,
	ParsedLedgerHeaderSourceRange,
	ParsedLedgerHeaderWatermark
} from '../../../domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { ParsedLedgerHeader } from '../../database/entities/ParsedLedgerHeader.js';
import { recordLedgerObservations } from './ParsedHistoryObservationWrite.js';
import {
	mapParsedLedgerHeaderDetails,
	parsedLedgerHeaderDetailsColumns,
	type ParsedLedgerHeaderDetailsRow,
	toParsedHistoryDate
} from './ParsedLedgerHeaderRow.js';

const maximumBatchSize = 1_000;
const maximumLedgerSequence = 0xffff_ffff;
const latestObservationCondition = `(
	excluded."lastSeenAt" > stored."lastSeenAt"
	or (
		excluded."lastSeenAt" = stored."lastSeenAt"
		and (excluded."lastSourceArchiveUrl", excluded."lastScanJobRemoteId") >
			(stored."lastSourceArchiveUrl", stored."lastScanJobRemoteId")
	)
)`;
const preferredClosedAtObservationCondition = `(
	excluded."closedAt" is not null
	and (
		stored."closedAt" is null
		or stored."closedAtObservedAt" is null
		or stored."closedAtSourceArchiveUrl" is null
		or stored."closedAtScanJobRemoteId" is null
		or excluded."closedAtObservedAt" < stored."closedAtObservedAt"
		or (
			excluded."closedAtObservedAt" = stored."closedAtObservedAt"
			and (
				excluded."closedAtSourceArchiveUrl",
				excluded."closedAtScanJobRemoteId"
			) < (
				stored."closedAtSourceArchiveUrl",
				stored."closedAtScanJobRemoteId"
			)
		)
	)
)`;

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

interface ParsedLedgerHeaderIdentityRow {
	readonly id: number | string;
	readonly ledgerHeaderHash: string;
	readonly ledgerSequence: string | number;
}

export class TypeOrmParsedLedgerHeaderRepository implements ParsedLedgerHeaderRepository {
	constructor(private readonly repository: Repository<ParsedLedgerHeader>) {}

	async findByLedgerSequence(
		ledgerSequence: number
	): Promise<ParsedLedgerHeaderDetails | null> {
		assertLedgerSequence(ledgerSequence);
		const rows = (await this.repository.query(
			`
				select ${parsedLedgerHeaderDetailsColumns}
				from parsed_ledger_header
				where "ledgerSequence" = $1
				order by
					("closedAt" is null) asc,
					"lastSeenAt" desc,
					"ledgerHeaderHash" asc
				limit 1
			`,
			[ledgerSequence]
		)) as ParsedLedgerHeaderDetailsRow[];
		return rows[0] === undefined ? null : mapParsedLedgerHeaderDetails(rows[0]);
	}

	async findByLedgerSequenceAndHash(
		ledgerSequence: number,
		ledgerHeaderHash: string
	): Promise<ParsedLedgerHeaderDetails | null> {
		assertLedgerSequence(ledgerSequence);
		assertNonEmpty(ledgerHeaderHash, 'ledgerHeaderHash');
		const rows = (await this.repository.query(
			`
				select ${parsedLedgerHeaderDetailsColumns}
				from parsed_ledger_header
				where "ledgerSequence" = $1 and "ledgerHeaderHash" = $2
				limit 1
			`,
			[ledgerSequence, ledgerHeaderHash]
		)) as ParsedLedgerHeaderDetailsRow[];
		return rows[0] === undefined ? null : mapParsedLedgerHeaderDetails(rows[0]);
	}

	async findBySourceObjectRemoteId(
		sourceObjectRemoteId: string
	): Promise<ParsedLedgerHeaderObjectObservation[]> {
		assertNonEmpty(sourceObjectRemoteId, 'sourceObjectRemoteId');
		const rows = (await this.repository.query(
			`
				select header.*, observation."closedAt" as "closedAt"
				from parsed_ledger_header_observation observation
				join parsed_ledger_header header
					on header.id = observation."parsedLedgerHeaderId"
				where observation."sourceObjectRemoteId" = $1
				order by header."ledgerSequence", header."ledgerHeaderHash"
			`,
			[sourceObjectRemoteId]
		)) as ParsedLedgerHeaderDetailsRow[];
		return rows.map((row) => {
			const details = mapParsedLedgerHeaderDetails(row);
			return {
				bucketListHash: details.bucketListHash,
				closedAt: details.closedAt,
				ledgerHeaderHash: details.ledgerHeaderHash,
				ledgerSequence: details.ledgerSequence,
				previousLedgerHeaderHash: details.previousLedgerHeaderHash,
				protocolVersion: details.protocolVersion,
				transactionResultHash: details.transactionResultHash,
				transactionSetHash: details.transactionSetHash
			};
		});
	}

	async findSourceRanges(
		limit: number
	): Promise<ParsedLedgerHeaderSourceRange[]> {
		assertPositiveSafeInteger(limit, 'limit');
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
			earliestLedgerSequence: toLedgerSequence(row.earliestLedgerSequence),
			latestLedgerSequence: toLedgerSequence(row.latestLedgerSequence),
			latestObservedAt: toParsedHistoryDate(row.latestObservedAt),
			parsedLedgerCount: toSafeNonNegativeInteger(
				row.parsedLedgerCount,
				'parsedLedgerCount'
			)
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
			parsedLedgerCount: toSafeNonNegativeInteger(
				countRows[0]?.parsedLedgerCount,
				'parsedLedgerCount'
			),
			sourceArchiveCount: toSafeNonNegativeInteger(
				sourceRows[0]?.sourceArchiveCount,
				'sourceArchiveCount'
			)
		};
	}

	async saveBatch(batch: ParsedLedgerHeaderBatchDTO): Promise<void> {
		if (batch.headers.length === 0) return;
		if (batch.headers.length > maximumBatchSize) {
			throw new RangeError(
				`Parsed ledger header batch exceeds ${maximumBatchSize}`
			);
		}

		const rows = batch.headers.map(
			(header) =>
				new ParsedLedgerHeader(
					header,
					batch.sourceArchiveUrl,
					batch.scanJobRemoteId,
					batch.observedAt
				)
		);
		assertUniqueRows(rows);

		const insert = buildInsert(rows);
		await this.repository.manager.transaction(async (manager) => {
			const returnedRows = await manager.query<ParsedLedgerHeaderIdentityRow[]>(
				`
					insert into "parsed_ledger_header" as stored (
						"ledgerSequence", "ledgerHeaderHash", "previousLedgerHeaderHash",
						"transactionSetHash", "transactionResultHash", "bucketListHash",
						"protocolVersion", "closedAt", "closedAtSourceArchiveUrl",
						"closedAtScanJobRemoteId", "closedAtObservedAt",
						"firstSourceArchiveUrl", "lastSourceArchiveUrl",
						"lastScanJobRemoteId", "firstSeenAt", "lastSeenAt"
					) values ${insert.placeholders}
					on conflict ("ledgerSequence", "ledgerHeaderHash") do update set
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
						"lastSeenAt" = greatest(stored."lastSeenAt", excluded."lastSeenAt"),
						"closedAtSourceArchiveUrl" = case
							when ${preferredClosedAtObservationCondition}
							then excluded."closedAtSourceArchiveUrl"
							else stored."closedAtSourceArchiveUrl"
						end,
						"closedAtScanJobRemoteId" = case
							when ${preferredClosedAtObservationCondition}
							then excluded."closedAtScanJobRemoteId"
							else stored."closedAtScanJobRemoteId"
						end,
						"closedAtObservedAt" = case
							when ${preferredClosedAtObservationCondition}
							then excluded."closedAtObservedAt"
							else stored."closedAtObservedAt"
						end,
						"closedAt" = coalesce(stored."closedAt", excluded."closedAt")
					where
						excluded."previousLedgerHeaderHash" = stored."previousLedgerHeaderHash"
						and excluded."transactionSetHash" = stored."transactionSetHash"
						and excluded."transactionResultHash" = stored."transactionResultHash"
						and excluded."bucketListHash" = stored."bucketListHash"
						and excluded."protocolVersion" = stored."protocolVersion"
						and (
							stored."closedAt" is null
							or excluded."closedAt" is null
							or excluded."closedAt" = stored."closedAt"
						)
					returning "id", "ledgerSequence", "ledgerHeaderHash"
				`,
				insert.parameters
			);
			const conflicts = findMissingIdentities(rows, returnedRows);
			if (conflicts.length > 0) {
				throw new ParsedLedgerHeaderConflictError(
					'stored-value-conflict',
					conflicts
				);
			}
			const sourceByIdentity = new Map(
				rows.map((row) => [
					identityKey(row.ledgerSequence, row.ledgerHeaderHash),
					row
				])
			);
			const observations = returnedRows.map((returned) => {
				const source = sourceByIdentity.get(
					identityKey(
						toLedgerSequence(returned.ledgerSequence),
						returned.ledgerHeaderHash
					)
				);
				if (source === undefined) {
					throw new Error(
						'Parsed ledger header upsert returned an unknown row'
					);
				}
				return {
					closedAt: source.closedAt,
					parsedRowId: toIntegerInRange(
						returned.id,
						0x7fff_ffff,
						'parsedLedgerHeaderId'
					)
				};
			});
			const observationCount = await recordLedgerObservations(
				manager,
				batch.scanJobRemoteId,
				batch.observedAt,
				observations
			);
			if (observationCount !== observations.length) {
				throw new ParsedLedgerHeaderConflictError(
					'stored-value-conflict',
					rows.map(toIdentity)
				);
			}
		});
	}
}

function buildInsert(rows: readonly ParsedLedgerHeader[]): {
	readonly parameters: unknown[];
	readonly placeholders: string;
} {
	const parameters: unknown[] = [];
	const placeholders = rows.map((row) => {
		const values: readonly unknown[] = [
			row.ledgerSequence,
			row.ledgerHeaderHash,
			row.previousLedgerHeaderHash,
			row.transactionSetHash,
			row.transactionResultHash,
			row.bucketListHash,
			row.protocolVersion,
			row.closedAt,
			row.closedAtSourceArchiveUrl,
			row.closedAtScanJobRemoteId,
			row.closedAtObservedAt,
			row.firstSourceArchiveUrl,
			row.lastSourceArchiveUrl,
			row.lastScanJobRemoteId,
			row.firstSeenAt,
			row.lastSeenAt
		];
		return `(${values.map((value) => `$${parameters.push(value)}`).join(', ')})`;
	});

	return { parameters, placeholders: placeholders.join(',\n') };
}

function assertUniqueRows(rows: readonly ParsedLedgerHeader[]): void {
	const identities = new Set<string>();
	for (const row of rows) {
		const key = identityKey(row.ledgerSequence, row.ledgerHeaderHash);
		if (identities.has(key)) {
			throw new ParsedLedgerHeaderConflictError('duplicate-batch-identity', [
				toIdentity(row)
			]);
		}
		identities.add(key);
	}
}

function findMissingIdentities(
	requested: readonly ParsedLedgerHeader[],
	returned: readonly ParsedLedgerHeaderIdentityRow[]
): ParsedLedgerHeaderIdentity[] {
	const returnedKeys = new Set(
		returned.map((row) =>
			identityKey(
				toLedgerSequence(row.ledgerSequence),
				assertNonEmpty(row.ledgerHeaderHash, 'ledgerHeaderHash')
			)
		)
	);
	return requested
		.filter(
			(row) =>
				!returnedKeys.has(identityKey(row.ledgerSequence, row.ledgerHeaderHash))
		)
		.map(toIdentity);
}

function toIdentity(row: ParsedLedgerHeader): ParsedLedgerHeaderIdentity {
	return {
		ledgerHeaderHash: row.ledgerHeaderHash,
		ledgerSequence: row.ledgerSequence
	};
}

function identityKey(ledgerSequence: number, ledgerHeaderHash: string): string {
	return JSON.stringify([ledgerSequence, ledgerHeaderHash]);
}

function assertLedgerSequence(value: number): void {
	toIntegerInRange(value, maximumLedgerSequence, 'ledgerSequence');
}

function toLedgerSequence(value: number | string): number {
	return toIntegerInRange(value, maximumLedgerSequence, 'ledgerSequence');
}

function assertPositiveSafeInteger(value: number, field: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${field} must be a positive safe integer`);
	}
}

function toSafeNonNegativeInteger(
	value: number | string | null | undefined,
	field: string
): number {
	if (value === undefined || value === null) return 0;
	return toIntegerInRange(value, Number.MAX_SAFE_INTEGER, field);
}

function toIntegerInRange(
	value: number | string,
	maximum: number,
	field: string
): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximum) {
		throw new RangeError(`${field} is outside its supported integer range`);
	}
	return parsed;
}

function assertNonEmpty(value: string, field: string): string {
	if (value.trim().length === 0) throw new Error(`${field} must not be empty`);
	return value;
}
