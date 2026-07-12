import type { DataSource } from 'typeorm';
import type {
	FullHistoryPromotionOutcome,
	FullHistoryPromotionRuntimeRepository,
	FullHistoryPromotionRuntimeState,
	FullHistoryPromotionRuntimeView
} from '../../../domain/full-history-promotion/FullHistoryPromotionRuntimeRepository.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	hashNetworkPassphrase,
	type FullHistoryUint64String
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface RuntimeRow {
	readonly checkpointLedger: number | string | null;
	readonly heartbeatAt: Date | string;
	readonly instanceId: string;
	readonly lastAttemptAt: Date | string | null;
	readonly lastErrorCode: string | null;
	readonly lastFailureAt: Date | string | null;
	readonly lastOutcome: FullHistoryPromotionOutcome | null;
	readonly lastSuccessAt: Date | string | null;
	readonly nextLedger: string | null;
	readonly startedAt: Date | string;
	readonly state: FullHistoryPromotionRuntimeState;
}

const errorCodePattern = /^[a-z][a-z0-9-]{0,63}$/;

export class TypeOrmFullHistoryPromotionRuntimeRepository implements FullHistoryPromotionRuntimeRepository {
	constructor(private readonly dataSource: DataSource) {}

	async begin(networkPassphrase: string, instanceId: string): Promise<void> {
		await this.dataSource.query(
			`insert into "full_history_promotion_runtime" (
				"network_passphrase_hash", "instance_id", state,
				"started_at", "heartbeat_at", "updated_at"
			) values ($1, $2, 'running', now(), now(), now())
			on conflict ("network_passphrase_hash") do update set
				"instance_id" = excluded."instance_id",
				state = 'running',
				"checkpoint_ledger" = null,
				"next_ledger" = null,
				"last_outcome" = null,
				"last_error_code" = null,
				"started_at" = now(),
				"heartbeat_at" = now(),
				"last_attempt_at" = null,
				"updated_at" = now()`,
			[networkHash(networkPassphrase), instanceId]
		);
	}

	async find(
		networkPassphrase: string
	): Promise<FullHistoryPromotionRuntimeView | null> {
		const rows = await this.dataSource.query<RuntimeRow[]>(
			`select
				"instance_id" as "instanceId", state,
				"checkpoint_ledger"::text as "checkpointLedger",
				"next_ledger"::text as "nextLedger",
				"last_outcome" as "lastOutcome",
				"last_error_code" as "lastErrorCode",
				"started_at" as "startedAt",
				"heartbeat_at" as "heartbeatAt",
				"last_attempt_at" as "lastAttemptAt",
				"last_success_at" as "lastSuccessAt",
				"last_failure_at" as "lastFailureAt"
			from "full_history_promotion_runtime"
			where "network_passphrase_hash" = $1`,
			[networkHash(networkPassphrase)]
		);
		const row = rows[0];
		return row === undefined ? null : mapRuntime(row);
	}

	async markAttempt(
		networkPassphrase: string,
		instanceId: string
	): Promise<void> {
		await this.updateOwned(
			networkPassphrase,
			instanceId,
			`state = 'promoting', "heartbeat_at" = now(),
			 "last_attempt_at" = now(), "last_error_code" = null`
		);
	}

	async recordFailure(
		networkPassphrase: string,
		instanceId: string,
		errorCode: string
	): Promise<void> {
		if (!errorCodePattern.test(errorCode)) {
			throw new TypeError('Invalid full-history promotion error code');
		}
		await this.updateOwned(
			networkPassphrase,
			instanceId,
			`state = 'failed', "heartbeat_at" = now(),
			 "last_error_code" = $3, "last_failure_at" = now()`,
			[errorCode]
		);
	}

	async recordOutcome(
		networkPassphrase: string,
		instanceId: string,
		input: {
			readonly checkpointLedger: number | null;
			readonly nextLedger: FullHistoryUint64String | null;
			readonly outcome: FullHistoryPromotionOutcome;
		}
	): Promise<void> {
		const waiting =
			input.outcome === 'bootstrap-required' ||
			input.outcome === 'proof-pending';
		await this.updateOwned(
			networkPassphrase,
			instanceId,
			`state = $3, "checkpoint_ledger" = $4,
			 "next_ledger" = $5, "last_outcome" = $6,
			 "last_error_code" = null, "heartbeat_at" = now(),
			 "last_success_at" = case when $6 in ('promoted', 'replayed')
				then now() else "last_success_at" end`,
			[
				waiting ? 'waiting-for-proof' : 'running',
				input.checkpointLedger,
				input.nextLedger,
				input.outcome
			]
		);
	}

	async stop(networkPassphrase: string, instanceId: string): Promise<void> {
		await this.updateOwned(
			networkPassphrase,
			instanceId,
			`state = 'stopped', "heartbeat_at" = now()`
		);
	}

	private async updateOwned(
		networkPassphrase: string,
		instanceId: string,
		assignments: string,
		extraParameters: readonly unknown[] = []
	): Promise<void> {
		const rows = await this.dataSource.query<{ readonly updated: number }[]>(
			`with updated as (
				update "full_history_promotion_runtime"
				set ${assignments}, "updated_at" = now()
				where "network_passphrase_hash" = $1
					and "instance_id" = $2
				returning 1
			)
			select count(*)::integer as updated from updated`,
			[networkHash(networkPassphrase), instanceId, ...extraParameters]
		);
		if (rows[0]?.updated !== 1) {
			throw new Error('Full-history promoter no longer owns runtime state');
		}
	}
}

function mapRuntime(row: RuntimeRow): FullHistoryPromotionRuntimeView {
	return {
		checkpointLedger:
			row.checkpointLedger === null
				? null
				: Number(fullHistoryLedgerSequence(row.checkpointLedger.toString())),
		heartbeatAt: toDate(row.heartbeatAt),
		instanceId: row.instanceId,
		lastAttemptAt: toNullableDate(row.lastAttemptAt),
		lastErrorCode: row.lastErrorCode,
		lastFailureAt: toNullableDate(row.lastFailureAt),
		lastOutcome: row.lastOutcome,
		lastSuccessAt: toNullableDate(row.lastSuccessAt),
		nextLedger:
			row.nextLedger === null ? null : fullHistoryUint64(row.nextLedger),
		startedAt: toDate(row.startedAt),
		state: row.state
	};
}

function networkHash(networkPassphrase: string): Buffer {
	return hashNetworkPassphrase(networkPassphrase).toBuffer();
}

function toNullableDate(value: Date | string | null): Date | null {
	return value === null ? null : toDate(value);
}

function toDate(value: Date | string): Date {
	const date = new Date(value);
	if (!Number.isFinite(date.valueOf()))
		throw new TypeError('Invalid runtime date');
	return date;
}
