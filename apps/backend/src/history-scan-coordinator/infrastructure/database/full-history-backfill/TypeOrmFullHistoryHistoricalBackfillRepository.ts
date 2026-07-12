import { randomUUID } from 'node:crypto';
import type { DataSource, EntityManager } from 'typeorm';
import {
	FULL_HISTORY_BACKFILL_MAX_ATTEMPTS,
	fullHistoryCheckpointLedger,
	fullHistoryHistoricalBackfillRange,
	type FullHistoryHistoricalBackfillJob,
	type FullHistoryHistoricalBackfillJobState,
	type FullHistoryHistoricalFrontier
} from '../../../domain/full-history-backfill/FullHistoryHistoricalBackfill.js';
import type {
	ClaimFullHistoryHistoricalBackfillInput,
	FullHistoryHistoricalBackfillRepository,
	FullHistoryHistoricalBackfillScheduleReceipt,
	OwnedFullHistoryHistoricalBackfillInput,
	RetryFullHistoryHistoricalBackfillInput,
	ScheduleFullHistoryHistoricalBackfillInput
} from '../../../domain/full-history-backfill/FullHistoryHistoricalBackfillRepository.js';
import {
	assertInteger,
	assertUuid,
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash,
	hashNetworkPassphrase
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import type { FullHistoryPromotionTarget } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import {
	claimHistoricalBackfillJobSql,
	completeHistoricalBackfillJobSql,
	historicalBackfillJobProjection,
	strictHistoricalBackfillProofTargetsSql
} from './FullHistoryHistoricalBackfillSql.js';

interface HistoricalBackfillJobRow {
	readonly attemptCount: number | string;
	readonly availableAt: Date | string;
	readonly completedAt: Date | string | null;
	readonly createdAt: Date | string;
	readonly firstCheckpointLedger: string;
	readonly id: string;
	readonly lastCheckpointLedger: string;
	readonly lastErrorCode: string | null;
	readonly leaseExpiresAt: Date | string | null;
	readonly leaseOwner: string | null;
	readonly leaseToken: string | null;
	readonly maxAttempts: number | string;
	readonly networkPassphraseHash: Uint8Array;
	readonly state: FullHistoryHistoricalBackfillJobState;
	readonly updatedAt: Date | string;
}

interface HistoricalFrontierRow {
	readonly firstBatchId: string;
	readonly firstLedger: string;
	readonly lastBatchId: string;
	readonly nextLedger: string;
	readonly updatedAt: Date | string;
}

const errorCodePattern = /^[a-z][a-z0-9-]{0,63}$/;
const leaseDurationMinimumMs = 1_000;
const leaseDurationMaximumMs = 15 * 60 * 1_000;
const retryDelayMaximumMs = 24 * 60 * 60 * 1_000;

export class TypeOrmFullHistoryHistoricalBackfillRepository implements FullHistoryHistoricalBackfillRepository {
	constructor(private readonly dataSource: DataSource) {}

	async schedule(
		input: ScheduleFullHistoryHistoricalBackfillInput
	): Promise<FullHistoryHistoricalBackfillScheduleReceipt> {
		const id = assertUuid(input.id, 'id');
		const maxAttempts = assertInteger(
			input.maxAttempts,
			'maxAttempts',
			1,
			FULL_HISTORY_BACKFILL_MAX_ATTEMPTS
		);
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		const range = fullHistoryHistoricalBackfillRange(
			input.range.firstCheckpointLedger,
			input.range.lastCheckpointLedger
		);

		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			await lockIdentity(manager, `network:${networkHash.toHex()}`);
			const exact = await findRange(manager, networkHash, range);
			if (exact !== null) return { created: false, job: exact };
			const frontiers = await manager.query<{ readonly firstLedger: string }[]>(
				`select "first_ledger"::text as "firstLedger"
				 from "full_history_watermark"
				 where "network_passphrase_hash" = $1`,
				[networkHash.toBuffer()]
			);
			const firstLedger = frontiers[0]?.firstLedger;
			if (
				firstLedger === undefined ||
				BigInt(range.lastCheckpointLedger) + 1n !== BigInt(firstLedger)
			) {
				throw new Error(
					'Historical backfill range is not immediately below the lower frontier'
				);
			}
			if ((await findJob(manager, id)) !== null) {
				throw new Error('Historical backfill job identity is already in use');
			}
			const overlaps = await manager.query<{ readonly count: number }[]>(
				`select count(*)::integer as count
				 from "full_history_historical_backfill_job"
				 where "network_passphrase_hash" = $1
					and "first_checkpoint_ledger" <= $3
					and "last_checkpoint_ledger" >= $2`,
				[
					networkHash.toBuffer(),
					range.firstCheckpointLedger,
					range.lastCheckpointLedger
				]
			);
			if (overlaps[0]?.count !== 0) {
				throw new Error('Historical backfill ranges must not overlap');
			}
			const rows = await manager.query<HistoricalBackfillJobRow[]>(
				`insert into "full_history_historical_backfill_job" (
					id, "network_passphrase_hash", "first_checkpoint_ledger",
					"last_checkpoint_ledger", "max_attempts"
				 ) values ($1, $2, $3, $4, $5)
					 returning ${historicalBackfillJobProjection}`,
				[
					id,
					networkHash.toBuffer(),
					range.firstCheckpointLedger,
					range.lastCheckpointLedger,
					maxAttempts
				]
			);
			return { created: true, job: mapJob(requiredRow(rows)) };
		});
	}

	async claim(
		input: ClaimFullHistoryHistoricalBackfillInput
	): Promise<FullHistoryHistoricalBackfillJob | null> {
		const workerId = assertUuid(input.workerId, 'workerId');
		const leaseDurationMs = validateLeaseDuration(input.leaseDurationMs);
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager);
			await lockIdentity(manager, `worker:${workerId}`);
			const active = await manager.query<HistoricalBackfillJobRow[]>(
				`select ${historicalBackfillJobProjection}
				 from "full_history_historical_backfill_job"
				 where state = 'leased' and "lease_owner" = $1
					and "network_passphrase_hash" = $2
					and "lease_expires_at" > now()
				 limit 1`,
				[workerId, networkHash.toBuffer()]
			);
			if (active[0] !== undefined) return mapJob(active[0]);

			const leaseToken = randomUUID();
			const rows = await manager.query<HistoricalBackfillJobRow[]>(
				claimHistoricalBackfillJobSql,
				[networkHash.toBuffer(), workerId, leaseToken, leaseDurationMs]
			);
			return rows[0] === undefined ? null : mapJob(rows[0]);
		});
	}

	async renew(
		input: OwnedFullHistoryHistoricalBackfillInput,
		leaseDurationMs: number
	): Promise<FullHistoryHistoricalBackfillJob> {
		const owner = validateOwner(input);
		const rows = await this.dataSource.query<HistoricalBackfillJobRow[]>(
			`with renewed as (
				update "full_history_historical_backfill_job"
				set "lease_expires_at" =
						now() + $4::integer * interval '1 millisecond',
					"updated_at" = now()
				where id = $1 and state = 'leased' and "lease_owner" = $2
					and "lease_token" = $3 and "lease_expires_at" > now()
				returning *
			 ) select ${historicalBackfillJobProjection} from renewed`,
			[
				owner.id,
				owner.workerId,
				owner.leaseToken,
				validateLeaseDuration(leaseDurationMs)
			]
		);
		return mapJob(requireOwnedRow(rows));
	}

	async retry(
		input: RetryFullHistoryHistoricalBackfillInput
	): Promise<FullHistoryHistoricalBackfillJob> {
		const owner = validateOwner(input);
		if (!errorCodePattern.test(input.errorCode)) {
			throw new TypeError('Invalid historical backfill error code');
		}
		const retryDelayMs = assertInteger(
			input.retryDelayMs,
			'retryDelayMs',
			0,
			retryDelayMaximumMs
		);
		const rows = await this.dataSource.query<HistoricalBackfillJobRow[]>(
			`with retried as (
				update "full_history_historical_backfill_job"
				set state = case when "attempt_count" >= "max_attempts"
						then 'failed' else 'pending' end,
					"available_at" =
						now() + $5::integer * interval '1 millisecond',
					"lease_owner" = null, "lease_token" = null,
					"lease_expires_at" = null, "last_error_code" = $4,
					"updated_at" = now()
				where id = $1 and state = 'leased' and "lease_owner" = $2
					and "lease_token" = $3 and "lease_expires_at" > now()
				returning *
			 ) select ${historicalBackfillJobProjection} from retried`,
			[
				owner.id,
				owner.workerId,
				owner.leaseToken,
				input.errorCode,
				retryDelayMs
			]
		);
		return mapJob(requireOwnedRow(rows));
	}

	async complete(
		input: OwnedFullHistoryHistoricalBackfillInput
	): Promise<void> {
		const owner = validateOwner(input);
		const rows = await this.dataSource.query<{ readonly id: string }[]>(
			completeHistoricalBackfillJobSql,
			[owner.id, owner.workerId, owner.leaseToken]
		);
		if (rows[0] !== undefined) return;
		const current = await this.find(owner.id);
		if (current?.state === 'completed') return;
		throw new Error('Historical backfill lease is not owned or not committed');
	}

	async find(id: string): Promise<FullHistoryHistoricalBackfillJob | null> {
		return findJob(this.dataSource.manager, assertUuid(id, 'id'));
	}

	async findBlockingJob(
		networkPassphrase: string
	): Promise<FullHistoryHistoricalBackfillJob | null> {
		const networkHash = hashNetworkPassphrase(networkPassphrase);
		const rows = await this.dataSource.query<HistoricalBackfillJobRow[]>(
			`select ${historicalBackfillJobProjection}
			 from (
				select job.*
				from "full_history_historical_backfill_job" job
				join "full_history_watermark" watermark
					on watermark."network_passphrase_hash" =
						job."network_passphrase_hash"
				where job."network_passphrase_hash" = $1
					and job.state <> 'completed'
					and watermark."first_ledger" <=
						job."last_checkpoint_ledger" + 1
				order by
					job."last_checkpoint_ledger" desc, job."created_at", job.id
				limit 1
			 ) job`,
			[networkHash.toBuffer()]
		);
		return rows[0] === undefined ? null : mapJob(rows[0]);
	}

	async findFrontier(
		networkPassphrase: string
	): Promise<FullHistoryHistoricalFrontier | null> {
		const rows = await this.dataSource.query<HistoricalFrontierRow[]>(
			`select "first_batch_id" as "firstBatchId",
				"first_ledger"::text as "firstLedger",
				"last_batch_id" as "lastBatchId",
				"next_ledger"::text as "nextLedger", "updated_at" as "updatedAt"
			 from "full_history_watermark"
			 where "network_passphrase_hash" = $1`,
			[hashNetworkPassphrase(networkPassphrase).toBuffer()]
		);
		const row = rows[0];
		return row === undefined
			? null
			: {
					firstBatchId: assertUuid(row.firstBatchId, 'firstBatchId'),
					firstLedger: fullHistoryLedgerSequence(
						row.firstLedger,
						'firstLedger'
					),
					lastBatchId: assertUuid(row.lastBatchId, 'lastBatchId'),
					nextLedger: fullHistoryUint64(row.nextLedger, 'nextLedger'),
					updatedAt: toDate(row.updatedAt)
				};
	}

	async findStrictProofTargets(
		networkPassphrase: string,
		checkpointLedger: number,
		maximumTargets: number
	): Promise<readonly FullHistoryPromotionTarget[]> {
		const checkpoint = Number(
			fullHistoryCheckpointLedger(BigInt(checkpointLedger), 'checkpointLedger')
		);
		assertInteger(maximumTargets, 'maximumTargets', 1, 8);
		const rows = await this.dataSource.query<
			Array<{ readonly archiveUrlIdentity: string }>
		>(strictHistoricalBackfillProofTargetsSql, [
			checkpoint,
			networkPassphrase,
			maximumTargets
		]);
		return rows.map((row) => ({
			archiveUrlIdentity: row.archiveUrlIdentity,
			checkpointLedger: checkpoint,
			networkPassphrase
		}));
	}
}

async function findRange(
	manager: EntityManager,
	networkHash: FullHistoryHash,
	range: ScheduleFullHistoryHistoricalBackfillInput['range']
): Promise<FullHistoryHistoricalBackfillJob | null> {
	const rows = await manager.query<HistoricalBackfillJobRow[]>(
		`select ${historicalBackfillJobProjection}
		 from "full_history_historical_backfill_job"
		 where "network_passphrase_hash" = $1
			and "first_checkpoint_ledger" = $2
			and "last_checkpoint_ledger" = $3`,
		[
			networkHash.toBuffer(),
			range.firstCheckpointLedger,
			range.lastCheckpointLedger
		]
	);
	return rows[0] === undefined ? null : mapJob(rows[0]);
}

async function findJob(
	manager: EntityManager,
	id: string
): Promise<FullHistoryHistoricalBackfillJob | null> {
	const rows = await manager.query<HistoricalBackfillJobRow[]>(
		`select ${historicalBackfillJobProjection}
		 from "full_history_historical_backfill_job" where id = $1`,
		[id]
	);
	return rows[0] === undefined ? null : mapJob(rows[0]);
}

function mapJob(
	row: HistoricalBackfillJobRow
): FullHistoryHistoricalBackfillJob {
	if (!isJobState(row.state)) throw new TypeError('Invalid backfill job state');
	return {
		attemptCount: toCount(row.attemptCount, 'attemptCount'),
		availableAt: toDate(row.availableAt),
		completedAt: toNullableDate(row.completedAt),
		createdAt: toDate(row.createdAt),
		id: assertUuid(row.id, 'id'),
		lastErrorCode: row.lastErrorCode,
		leaseExpiresAt: toNullableDate(row.leaseExpiresAt),
		leaseOwner:
			row.leaseOwner === null ? null : assertUuid(row.leaseOwner, 'leaseOwner'),
		leaseToken:
			row.leaseToken === null ? null : assertUuid(row.leaseToken, 'leaseToken'),
		maxAttempts: toCount(row.maxAttempts, 'maxAttempts'),
		networkPassphraseHash: FullHistoryHash.fromBytes(row.networkPassphraseHash),
		range: fullHistoryHistoricalBackfillRange(
			row.firstCheckpointLedger,
			row.lastCheckpointLedger
		),
		state: row.state,
		updatedAt: toDate(row.updatedAt)
	};
}

function validateOwner(
	input: OwnedFullHistoryHistoricalBackfillInput
): OwnedFullHistoryHistoricalBackfillInput {
	return {
		id: assertUuid(input.id, 'id'),
		leaseToken: assertUuid(input.leaseToken, 'leaseToken'),
		workerId: assertUuid(input.workerId, 'workerId')
	};
}

function validateLeaseDuration(value: number): number {
	return assertInteger(
		value,
		'leaseDurationMs',
		leaseDurationMinimumMs,
		leaseDurationMaximumMs
	);
}

async function setTransactionBounds(manager: EntityManager): Promise<void> {
	await manager.query(
		`set local lock_timeout = '2s'; set local statement_timeout = '30s'`
	);
}

async function lockIdentity(
	manager: EntityManager,
	identity: string
): Promise<void> {
	await manager.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
		identity
	]);
}

function requiredRow(
	rows: readonly HistoricalBackfillJobRow[]
): HistoricalBackfillJobRow {
	const row = rows[0];
	if (row === undefined)
		throw new Error('Historical backfill write returned no row');
	return row;
}

function requireOwnedRow(
	rows: readonly HistoricalBackfillJobRow[]
): HistoricalBackfillJobRow {
	const row = rows[0];
	if (row === undefined)
		throw new Error('Historical backfill lease is not owned');
	return row;
}

function toCount(value: number | string, field: string): number {
	const count = Number(value);
	return assertInteger(count, field, 0, FULL_HISTORY_BACKFILL_MAX_ATTEMPTS);
}

function toNullableDate(value: Date | string | null): Date | null {
	return value === null ? null : toDate(value);
}

function toDate(value: Date | string): Date {
	const date = new Date(value);
	if (!Number.isFinite(date.valueOf()))
		throw new TypeError('Invalid backfill date');
	return date;
}

function isJobState(
	value: string
): value is FullHistoryHistoricalBackfillJobState {
	return ['completed', 'failed', 'leased', 'pending'].includes(value);
}
