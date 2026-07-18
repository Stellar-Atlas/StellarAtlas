import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { EntityManager, Repository } from 'typeorm';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import type {
	ScpLatestObservedLedger,
	ScpStatementObservationFilter,
	ScpStatementObservationRepository,
	ScpStatementProjectionEventPage,
	ScpStatementProjectionEventPageFilter,
	ScpStatementProjectionPage,
	ScpStatementProjectionPageFilter,
	ScpStatementWriter
} from '@network-scan/domain/scp/ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from '@network-scan/domain/scp/ScpStatementObservationPolicy.js';
import { batchScpStatementObservationsForUpsert } from '@network-scan/domain/scp/ScpStatementObservationConflictPolicy.js';
import { selectLatestObservedScpLedger } from '@network-scan/domain/scp/ScpLatestObservedLedger.js';
import { createScpStatementObservationUpsertQuery } from './ScpStatementObservationUpsertQuery.js';
import { findLatestScpAnimationSlots } from './ScpStatementAnimationQuery.js';

type DeletedObservationRow = { readonly id: number | string };
type DeleteQueryResult =
	| DeletedObservationRow[]
	| [DeletedObservationRow[], number]
	| { raw: DeletedObservationRow[] }
	| { records: DeletedObservationRow[] };
type DeleteQueryArray =
	DeletedObservationRow[] | [DeletedObservationRow[], number];

interface ScpStatementObservationRow {
	readonly id: number | string;
	readonly nodeId: string;
	readonly observedAt: Date | string;
	readonly observedFromAddress: string;
	readonly observedFromPeer: string;
	readonly pledges: CrawlerScpStatementObservation['pledges'];
	readonly signature: string;
	readonly slotIndex: string;
	readonly statementHash: string;
	readonly statementType: CrawlerScpStatementObservation['statementType'];
	readonly statementXdr: string;
	readonly values: CrawlerScpStatementObservation['values'];
}

interface ProjectionEventRow {
	readonly id: number | string;
	readonly statementHash: string;
}

interface LatestObservedLedgerRow {
	readonly closedAt: Date | string;
	readonly observedAt: Date | string;
	readonly sequence: number | string;
	readonly source: ScpStatementWriter;
}

interface ScpStatementRepositoryOptions {
	lockTimeoutMs?: number;
	poolAcquireTimeoutMs?: number;
	statementTimeoutMs?: number;
}

interface PostgresPoolDriver {
	master?: {
		options?: { connectionTimeoutMillis?: number };
	};
}

const observationColumns = `
	id,
	"nodeId",
	"observedAt",
	"observedFromAddress",
	"observedFromPeer",
	pledges,
	signature,
	"slotIndex",
	"statementHash",
	"statementType",
	"statementXdr",
	values
`;

export class TypeOrmScpStatementObservationRepository implements ScpStatementObservationRepository {
	private readonly lockTimeoutMs: number;
	private readonly poolAcquireTimeoutMs: number;
	private readonly statementTimeoutMs: number;

	constructor(
		private repository: Repository<ScpStatementObservation>,
		options: ScpStatementRepositoryOptions = {}
	) {
		this.lockTimeoutMs =
			options.lockTimeoutMs ??
			scpStatementObservationPolicy.databaseLockTimeoutMs;
		this.poolAcquireTimeoutMs =
			options.poolAcquireTimeoutMs ??
			scpStatementObservationPolicy.databasePoolAcquireTimeoutMs;
		this.statementTimeoutMs =
			options.statementTimeoutMs ??
			scpStatementObservationPolicy.databaseStatementTimeoutMs;
		this.configurePoolAcquisitionTimeout();
	}

	async deleteOlderThan(before: Date, limit: number): Promise<number> {
		if (!Number.isFinite(limit) || limit <= 0) return 0;
		const boundedLimit = Math.min(
			Math.floor(limit),
			scpStatementObservationPolicy.cleanupBatchSize
		);
		const rows = await this.withTimeouts(async (manager) =>
			extractDeletedRows(
				(await manager.query(
					`
					with expired_observations as (
						select id
						from scp_statement_observation
						where "observedAt" < $1
						order by "observedAt" asc, id asc
						limit $2
						for update skip locked
					)
					delete from scp_statement_observation
					using expired_observations
					where scp_statement_observation.id = expired_observations.id
					returning scp_statement_observation.id
				`,
					[before, boundedLimit]
				)) as DeleteQueryResult
			)
		);

		return rows.length;
	}

	async deleteProjectionEventsOlderThan(
		before: Date,
		limit: number
	): Promise<number> {
		if (!Number.isFinite(limit) || limit <= 0) return 0;
		const boundedLimit = Math.min(
			Math.floor(limit),
			scpStatementObservationPolicy.cleanupBatchSize
		);
		const rows = await this.withTimeouts(async (manager) =>
			extractDeletedRows(
				(await manager.query(
					`
						with expired_events as (
							select id
							from scp_statement_projection_event
							where "createdAt" < $1
							order by "createdAt" asc, id asc
							limit $2
							for update skip locked
						)
						delete from scp_statement_projection_event
						using expired_events
						where scp_statement_projection_event.id = expired_events.id
						returning scp_statement_projection_event.id
					`,
					[before, boundedLimit]
				)) as DeleteQueryResult
			)
		);

		return rows.length;
	}

	async saveMany(
		observations: readonly CrawlerScpStatementObservation[],
		writer: ScpStatementWriter
	): Promise<CrawlerScpStatementObservation[]> {
		if (observations.length === 0) return [];

		const batches = batchScpStatementObservationsForUpsert(
			observations,
			scpStatementObservationPolicy.persistenceBatchSize
		);
		const statementHashes = [
			...new Set(observations.map(({ statementHash }) => statementHash))
		].sort();
		return this.withTimeouts(async (manager) => {
			for (const batch of batches) {
				const query = createScpStatementObservationUpsertQuery(batch);
				await manager.query(query.sql, query.parameters);
			}

			const winners: CrawlerScpStatementObservation[] = [];
			for (
				let start = 0;
				start < statementHashes.length;
				start += scpStatementObservationPolicy.persistenceBatchSize
			) {
				const hashes = statementHashes.slice(
					start,
					start + scpStatementObservationPolicy.persistenceBatchSize
				);
				const rows = (await manager.query(
					`
						select ${observationColumns}
						from scp_statement_observation
						where "statementHash" = any($1::text[])
						order by "statementHash" asc
						for share
					`,
					[hashes]
				)) as ScpStatementObservationRow[];
				winners.push(...rows.map(mapObservationRow));
			}
			const latestLedger = selectLatestObservedScpLedger(winners, writer);
			if (latestLedger !== null) {
				await this.saveLatestObservedLedger(manager, latestLedger);
			}

			return winners;
		});
	}

	async findLatestObservedLedger(): Promise<ScpLatestObservedLedger | null> {
		return this.withTimeouts(async (manager) => {
			const rows = (await manager.query(`
				select "sequence", "closedAt", "observedAt", "source"
				from scp_latest_observed_ledger
				where id = 1
			`)) as LatestObservedLedgerRow[];
			const row = rows[0];
			if (row === undefined) return null;
			return {
				closedAt: toDate(row.closedAt),
				observedAt: toDate(row.observedAt),
				sequence: String(row.sequence),
				source: row.source
			};
		});
	}

	async findLatestAnimationSlots(limit: number, eventLimit?: number) {
		return await this.withTimeouts(async (manager) =>
			findLatestScpAnimationSlots(manager, limit, eventLimit)
		);
	}

	async findProjectionEventPage({
		afterId,
		limit
	}: ScpStatementProjectionEventPageFilter): Promise<ScpStatementProjectionEventPage> {
		if (!Number.isFinite(limit) || limit <= 0) {
			return { hasMore: false, nextAfterId: afterId, observations: [] };
		}
		const boundedLimit = Math.min(
			Math.floor(limit),
			scpStatementObservationPolicy.projectionEventTailBatchSize
		);
		return this.withTimeouts(async (manager) => {
			const events = (await manager.query(
				`
					select id, "statementHash"
					from scp_statement_projection_event
					where id > $1
					order by id asc
					limit $2
				`,
				[afterId, boundedLimit]
			)) as ProjectionEventRow[];
			const lastEvent = events.at(-1);
			if (lastEvent === undefined) {
				return { hasMore: false, nextAfterId: afterId, observations: [] };
			}
			const hashes = [
				...new Set(events.map(({ statementHash }) => statementHash))
			];
			const rows = (await manager.query(
				`
					select ${observationColumns}
					from scp_statement_observation
					where "statementHash" = any($1::text[])
					order by "statementHash" asc
				`,
				[hashes]
			)) as ScpStatementObservationRow[];
			return {
				hasMore: events.length === boundedLimit,
				nextAfterId: Number(lastEvent.id),
				observations: rows.map(mapObservationRow)
			};
		});
	}

	async findProjectionPage({
		afterId,
		limit,
		observedAfter
	}: ScpStatementProjectionPageFilter): Promise<ScpStatementProjectionPage> {
		if (!Number.isFinite(limit) || limit <= 0) {
			return { nextAfterId: null, observations: [] };
		}
		const boundedLimit = Math.min(
			Math.floor(limit),
			scpStatementObservationPolicy.projectionBackfillBatchSize
		);
		return this.withTimeouts(async (manager) => {
			const rows = (await manager.query(
				`
					select ${observationColumns}
					from scp_statement_observation
					where id > $1 and "observedAt" >= $2
					order by id asc
					limit $3
				`,
				[afterId, observedAfter, boundedLimit]
			)) as ScpStatementObservationRow[];
			const lastRow = rows.at(-1);
			return {
				nextAfterId:
					rows.length === boundedLimit && lastRow !== undefined
						? Number(lastRow.id)
						: null,
				observations: rows.map(mapObservationRow)
			};
		});
	}

	async findLatest({
		after,
		limit,
		nodeId,
		nodeIds,
		order,
		slotIndex
	}: ScpStatementObservationFilter): Promise<ScpStatementObservation[]> {
		const direction = order === 'asc' ? 'ASC' : 'DESC';
		return this.withTimeouts(async (manager) => {
			const builder = manager
				.getRepository(ScpStatementObservation)
				.createQueryBuilder('observation')
				.orderBy('observation.observedAt', direction)
				.addOrderBy('observation.statementHash', direction)
				.limit(limit);

			if (after !== undefined) {
				const comparison = direction === 'ASC' ? '>' : '<';
				builder.andWhere(
					`(observation.observedAt ${comparison} :afterObservedAt OR ` +
						`(observation.observedAt = :afterObservedAt AND observation.statementHash ${comparison} :afterStatementHash))`,
					{
						afterObservedAt: new Date(after.observedAtMs),
						afterStatementHash: after.statementHash
					}
				);
			}

			if (nodeId !== undefined) {
				builder.andWhere('observation.nodeId = :nodeId', { nodeId });
			}
			if (nodeIds !== undefined) {
				if (nodeIds.length === 0) return [];
				builder.andWhere('observation.nodeId IN (:...nodeIds)', { nodeIds });
			}

			if (slotIndex !== undefined) {
				builder.andWhere('observation.slotIndex = :slotIndex', { slotIndex });
			}

			return builder.getMany();
		});
	}

	private async saveLatestObservedLedger(
		manager: EntityManager,
		ledger: ScpLatestObservedLedger
	): Promise<void> {
		await manager.query(
			`
				insert into scp_latest_observed_ledger as stored (
					id, "sequence", "closedAt", "observedAt", "source"
				)
				values (1, $1::numeric, $2, $3, $4)
				on conflict (id) do update set
					"sequence" = excluded."sequence",
					"closedAt" = excluded."closedAt",
					"observedAt" = excluded."observedAt",
					"source" = excluded."source"
				where excluded."sequence" > stored."sequence"
					or (
						excluded."sequence" = stored."sequence"
						and excluded."closedAt" > stored."closedAt"
					)
			`,
			[ledger.sequence, ledger.closedAt, ledger.observedAt, ledger.source]
		);
	}

	private async withTimeouts<T>(
		work: (manager: EntityManager) => Promise<T>
	): Promise<T> {
		return this.repository.manager.transaction(async (manager) => {
			await manager.query(
				`
					select
						set_config('lock_timeout', $1, true),
						set_config('statement_timeout', $2, true),
						set_config('idle_in_transaction_session_timeout', $3, true)
				`,
				[
					`${this.lockTimeoutMs}ms`,
					`${this.statementTimeoutMs}ms`,
					`${this.statementTimeoutMs}ms`
				]
			);
			return work(manager);
		});
	}

	private configurePoolAcquisitionTimeout(): void {
		const driver = this.repository.manager.connection?.driver as unknown as
			PostgresPoolDriver | undefined;
		const options = driver?.master?.options;
		if (options === undefined) return;
		const current = options.connectionTimeoutMillis;
		if (
			current === undefined ||
			!Number.isFinite(current) ||
			current <= 0 ||
			current > this.poolAcquireTimeoutMs
		) {
			options.connectionTimeoutMillis = this.poolAcquireTimeoutMs;
		}
	}
}

function mapObservationRow(
	row: ScpStatementObservationRow
): CrawlerScpStatementObservation {
	return {
		nodeId: row.nodeId,
		observedAt:
			row.observedAt instanceof Date
				? row.observedAt
				: new Date(row.observedAt),
		observedFromAddress: row.observedFromAddress,
		observedFromPeer: row.observedFromPeer,
		pledges: row.pledges,
		signature: row.signature,
		slotIndex: row.slotIndex,
		statementHash: row.statementHash,
		statementType: row.statementType,
		statementXdr: row.statementXdr,
		values: row.values
	};
}

function toDate(value: Date | string): Date {
	return value instanceof Date ? value : new Date(value);
}

function extractDeletedRows(
	result: DeleteQueryResult
): DeletedObservationRow[] {
	if (Array.isArray(result)) {
		if (isStructuredDeleteQueryArray(result)) return result[0];
		return result;
	}

	if ('records' in result) return result.records;
	return result.raw;
}

function isStructuredDeleteQueryArray(
	result: DeleteQueryArray
): result is [DeletedObservationRow[], number] {
	return Array.isArray(result[0]);
}
