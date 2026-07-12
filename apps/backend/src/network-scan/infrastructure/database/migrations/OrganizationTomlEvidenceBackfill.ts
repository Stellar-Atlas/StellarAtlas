import type { DataSource, QueryRunner } from 'typeorm';
import type { OrganizationTomlAttempt } from '@network-scan/domain/organization/scan/OrganizationTomlAttempt.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import {
	TOML_TLS_CERTIFICATE_WARNING,
	type TomlFetchWarning
} from '@network-scan/domain/network/scan/TomlService.js';
import { upsertTomlSnapshot } from '../repositories/OrganizationTomlEvidencePersistence.js';

const MEBIBYTE = 1_024n * 1_024n;
const ESTIMATED_FIXED_PEAK_BYTES = 64n * MEBIBYTE;
const ESTIMATED_PEAK_BYTES_PER_ORGANIZATION = 2n * MEBIBYTE;
export const ORGANIZATION_TOML_BACKFILL_DISK_RESERVE_BYTES =
	8n * 1_024n * MEBIBYTE;
export const ORGANIZATION_TOML_BACKFILL_QUARANTINE_RETENTION = 4_096;

const SUCCESS_STATES = [
	TomlState.Ok,
	TomlState.UnsupportedVersion,
	TomlState.ValidatorNotSEP20Linked,
	TomlState.EmptyValidatorsField
] as const;
const SUCCESS_STATE_SET = new Set<TomlState>(SUCCESS_STATES);

interface ProgressRow {
	readonly completed: unknown;
	readonly lastOrganizationId: unknown;
}

interface LegacyMeasurementRow {
	readonly organizationId: unknown;
	readonly time: unknown;
	readonly tomlState: unknown;
	readonly tomlWarnings: unknown;
}

interface LegacyAttemptRow {
	readonly authoritative: unknown;
	readonly contentHash: unknown;
	readonly observedAt: unknown;
	readonly result: unknown;
	readonly sequence: unknown;
	readonly source: unknown;
	readonly state: unknown;
	readonly warnings: unknown;
}

export interface OrganizationTomlBackfillCapacity {
	readonly availableBytes: bigint;
	readonly reserveBytes?: bigint;
}

export interface OrganizationTomlBackfillBatchResult {
	readonly completed: boolean;
	readonly insertedAttempts: number;
	readonly pauseReason: 'insufficient_disk' | null;
	readonly peakEstimateBytes: string;
	readonly processedOrganizations: number;
	readonly quarantinedRows: number;
}

type BackfillQuarantineReason = 'invalid_state' | 'invalid_warnings';

export function estimateOrganizationTomlBackfillPeakBytes(
	batchSize: number
): bigint {
	requireBatchSize(batchSize);
	return (
		ESTIMATED_FIXED_PEAK_BYTES +
		BigInt(batchSize) * ESTIMATED_PEAK_BYTES_PER_ORGANIZATION
	);
}

export class OrganizationTomlEvidenceBackfill {
	constructor(
		private readonly batchSize = 25,
		private readonly quarantineRetention = ORGANIZATION_TOML_BACKFILL_QUARANTINE_RETENTION
	) {
		requireBatchSize(batchSize);
		requireQuarantineRetention(quarantineRetention);
	}

	async runBatch(
		dataSource: DataSource,
		capacity: OrganizationTomlBackfillCapacity
	): Promise<OrganizationTomlBackfillBatchResult> {
		const peakEstimate = estimateOrganizationTomlBackfillPeakBytes(
			this.batchSize
		);
		const reserve =
			capacity.reserveBytes ?? ORGANIZATION_TOML_BACKFILL_DISK_RESERVE_BYTES;
		requireByteCount(capacity.availableBytes, 'available');
		requireByteCount(reserve, 'reserve');
		if (capacity.availableBytes < reserve + peakEstimate) {
			return this.result(false, 0, 0, 0, peakEstimate, 'insufficient_disk');
		}

		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		try {
			await runner.query(`set local lock_timeout = '2s'`);
			await runner.query(`set local statement_timeout = '30s'`);
			await runner.query(`set local work_mem = '4MB'`);
			await runner.query(`set local temp_file_limit = '64MB'`);
			const progress = await this.lockProgress(runner);
			if (progress.completed === true) {
				await runner.commitTransaction();
				return this.result(true, 0, 0, 0, peakEstimate, null);
			}

			const organizationIds = await this.loadOrganizationIds(runner, progress);
			const rows = await this.loadMeaningfulEvidence(runner, organizationIds);
			let insertedAttempts = 0;
			let quarantinedRows = 0;
			for (const row of rows) {
				const outcome = await this.backfillMeasurement(runner, row);
				if (outcome === 'inserted') insertedAttempts++;
				if (outcome === 'quarantined') quarantinedRows++;
			}
			await this.enforceQuarantineRetention(runner);
			const completed = organizationIds.length < this.batchSize;
			await this.advanceProgress(runner, organizationIds.at(-1), completed);
			await runner.commitTransaction();
			return this.result(
				completed,
				organizationIds.length,
				insertedAttempts,
				quarantinedRows,
				peakEstimate,
				null
			);
		} catch (error) {
			await runner.rollbackTransaction();
			throw error;
		} finally {
			await runner.release();
		}
	}

	private result(
		completed: boolean,
		processedOrganizations: number,
		insertedAttempts: number,
		quarantinedRows: number,
		peakEstimateBytes: bigint,
		pauseReason: OrganizationTomlBackfillBatchResult['pauseReason']
	): OrganizationTomlBackfillBatchResult {
		return {
			completed,
			insertedAttempts,
			pauseReason,
			peakEstimateBytes: peakEstimateBytes.toString(),
			processedOrganizations,
			quarantinedRows
		};
	}

	private async lockProgress(queryRunner: QueryRunner): Promise<ProgressRow> {
		const rows = (await queryRunner.query(`
			select "lastOrganizationId", "completed"
			from "organization_toml_backfill_progress"
			where "phase" = 'organizations'
			for update
		`)) as ProgressRow[];
		const row = rows[0];
		if (row === undefined)
			throw new Error('Missing TOML backfill progress row');
		return row;
	}

	private async loadOrganizationIds(
		queryRunner: QueryRunner,
		progress: ProgressRow
	): Promise<number[]> {
		const cursor = requireNullableOrganizationId(progress.lastOrganizationId);
		const rows = (await queryRunner.query(
			`select id from "organization"
			 where id > coalesce($1::integer, 0)
			 order by id
			 limit $2`,
			[cursor, this.batchSize]
		)) as Array<{ id: unknown }>;
		return rows.map((row) => requireOrganizationId(row.id));
	}

	private async loadMeaningfulEvidence(
		queryRunner: QueryRunner,
		organizationIds: number[]
	): Promise<LegacyMeasurementRow[]> {
		if (organizationIds.length === 0) return [];
		return (await queryRunner.query(
			`
				with latest_times as (
					select measurement."organizationId",
						max(measurement."time") filter (
							where measurement."tomlState"::text <> $2
						) as "latestAttemptAt",
						max(measurement."time") filter (
							where measurement."tomlState"::text <> $2
								and not (
									measurement."tomlState"::text = any($3::text[])
								)
						) as "latestFailureAt",
						max(measurement."time") filter (
							where measurement."tomlState"::text <> $2
								and coalesce(
									measurement."tomlWarnings", '[]'::jsonb
								) ? $4
						) as "latestInsecureAt"
					from "organization_measurement" measurement
					where measurement."organizationId" = any($1::integer[])
					group by measurement."organizationId"
				), candidate_times as (
					select latest."organizationId", candidate."observedAt"
					from latest_times latest
					cross join lateral (
						select distinct selected."observedAt"
						from (values
							(latest."latestAttemptAt"),
							(latest."latestFailureAt"),
							(latest."latestInsecureAt")
						) selected("observedAt")
						where selected."observedAt" is not null
					) candidate
				)
				select measurement."organizationId", measurement."time",
					measurement."tomlState", measurement."tomlWarnings"
				from candidate_times candidate
				join "organization_measurement" measurement
					on measurement."organizationId" = candidate."organizationId"
					and measurement."time" = candidate."observedAt"
				order by measurement."organizationId", measurement."time"
			`,
			[
				organizationIds,
				TomlState.Unknown,
				SUCCESS_STATES,
				TOML_TLS_CERTIFICATE_WARNING
			]
		)) as LegacyMeasurementRow[];
	}

	private async backfillMeasurement(
		queryRunner: QueryRunner,
		row: LegacyMeasurementRow
	): Promise<'existing' | 'inserted' | 'quarantined'> {
		const organizationId = requireOrganizationId(row.organizationId);
		const observedAt = requireDate(row.time);
		const state = parseTomlState(row.tomlState);
		if (state === null) {
			await this.quarantineRow(
				queryRunner,
				organizationId,
				observedAt,
				'invalid_state'
			);
			return 'quarantined';
		}
		const warnings = parseWarnings(row.tomlWarnings);
		if (warnings === null) {
			await this.quarantineRow(
				queryRunner,
				organizationId,
				observedAt,
				'invalid_warnings'
			);
			return 'quarantined';
		}
		const result = SUCCESS_STATE_SET.has(state) ? 'success' : 'failure';
		const attempt: OrganizationTomlAttempt = {
			authoritative: false,
			content: null,
			observedAt,
			result,
			runId: `legacy:${organizationId}:${observedAt.toISOString()}`,
			state,
			warnings
		};
		const persisted = await insertLegacyAttempt(
			queryRunner,
			organizationId,
			attempt
		);
		await upsertTomlSnapshot(
			queryRunner.manager,
			organizationId,
			attempt,
			persisted.sequence,
			null
		);
		return persisted.inserted ? 'inserted' : 'existing';
	}

	private async quarantineRow(
		queryRunner: QueryRunner,
		organizationId: number,
		measurementTime: Date,
		reasonCode: BackfillQuarantineReason
	): Promise<void> {
		await queryRunner.query(
			`insert into "organization_toml_backfill_quarantine" (
				"organizationId", "measurementTime", "reasonCode"
			 ) values ($1, $2, $3)
			 on conflict ("organizationId", "measurementTime", "reasonCode")
			 do update set
				"lastObservedAt" = now(),
				"occurrences" = least(
					"organization_toml_backfill_quarantine"."occurrences" + 1,
					2147483647
				)`,
			[organizationId, measurementTime, reasonCode]
		);
	}

	private async enforceQuarantineRetention(
		queryRunner: QueryRunner
	): Promise<void> {
		await queryRunner.query(
			`delete from "organization_toml_backfill_quarantine" quarantine
			 where quarantine.ctid in (
				select candidate.ctid
				from "organization_toml_backfill_quarantine" candidate
				order by candidate."lastObservedAt" desc,
					candidate."organizationId" desc,
					candidate."measurementTime" desc,
					candidate."reasonCode" desc
				offset $1
			 )`,
			[this.quarantineRetention]
		);
	}

	private async advanceProgress(
		queryRunner: QueryRunner,
		lastOrganizationId: number | undefined,
		completed: boolean
	): Promise<void> {
		await queryRunner.query(
			`update "organization_toml_backfill_progress"
			 set "lastOrganizationId" = coalesce($1, "lastOrganizationId"),
				"completed" = $2, "updatedAt" = now()
			 where "phase" = 'organizations'`,
			[lastOrganizationId ?? null, completed]
		);
	}
}

async function insertLegacyAttempt(
	queryRunner: QueryRunner,
	organizationId: number,
	attempt: OrganizationTomlAttempt
): Promise<{ inserted: boolean; sequence: string }> {
	const rows = (await queryRunner.query(
		`insert into "organization_toml_attempt" (
			"organizationId", "scanRunId", "observedAt", "result", "state",
			"warnings", "authoritative", "contentHash", "source"
		 ) values ($1, $2, $3, $4, $5, $6::jsonb, false, null, 'legacy_backfill')
		 on conflict ("organizationId", "scanRunId") do nothing
		 returning "sequence"::text as "sequence"`,
		[
			organizationId,
			attempt.runId,
			attempt.observedAt,
			attempt.result,
			attempt.state,
			JSON.stringify(attempt.warnings)
		]
	)) as LegacyAttemptRow[];
	if (rows[0] !== undefined) {
		return { inserted: true, sequence: requireSequence(rows[0].sequence) };
	}
	const existing = (await queryRunner.query(
		`select "sequence"::text as "sequence", "observedAt", "result", "state",
			"warnings", "authoritative", "contentHash", "source"
		 from "organization_toml_attempt"
		 where "organizationId" = $1 and "scanRunId" = $2`,
		[organizationId, attempt.runId]
	)) as LegacyAttemptRow[];
	assertLegacyAttempt(existing[0], attempt);
	return { inserted: false, sequence: requireSequence(existing[0]?.sequence) };
}

function assertLegacyAttempt(
	row: LegacyAttemptRow | undefined,
	attempt: OrganizationTomlAttempt
): void {
	const matches =
		row !== undefined &&
		requireDate(row.observedAt).getTime() === attempt.observedAt.getTime() &&
		row.result === attempt.result &&
		row.state === attempt.state &&
		JSON.stringify(row.warnings) === JSON.stringify(attempt.warnings) &&
		row.authoritative === false &&
		row.contentHash === null &&
		row.source === 'legacy_backfill';
	if (!matches)
		throw new Error(`Conflicting legacy TOML evidence ${attempt.runId}`);
}

function requireBatchSize(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
		throw new Error('Organization TOML backfill batch size must be 1..1000');
	}
}

function requireQuarantineRetention(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > 100_000) {
		throw new Error(
			'Organization TOML backfill quarantine retention must be 1..100000'
		);
	}
}

function requireByteCount(value: bigint, label: string): void {
	if (typeof value !== 'bigint' || value < 0n) {
		throw new Error(`Organization TOML backfill ${label} bytes are invalid`);
	}
}

function requireOrganizationId(value: unknown): number {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) {
		throw new Error('Invalid organization id in TOML backfill');
	}
	return id;
}

function requireNullableOrganizationId(value: unknown): number | null {
	return value === null || value === undefined
		? null
		: requireOrganizationId(value);
}

function requireSequence(value: unknown): string {
	const sequence = String(value);
	if (!/^[1-9][0-9]*$/.test(sequence)) {
		throw new Error('Invalid TOML backfill sequence');
	}
	return sequence;
}

function requireDate(value: unknown): Date {
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.getTime())) {
		throw new Error('Invalid TOML backfill time');
	}
	return date;
}

function parseTomlState(value: unknown): TomlState | null {
	if (
		typeof value !== 'string' ||
		!Object.values(TomlState).includes(value as TomlState) ||
		value === TomlState.Unknown
	) {
		return null;
	}
	return value as TomlState;
}

function parseWarnings(value: unknown): TomlFetchWarning[] | null {
	if (!Array.isArray(value)) return null;
	if (value.some((warning) => warning !== TOML_TLS_CERTIFICATE_WARNING)) {
		return null;
	}
	return [...value] as TomlFetchWarning[];
}
