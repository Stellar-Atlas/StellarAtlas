import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import type Organization from '@network-scan/domain/organization/Organization.js';
import type OrganizationMeasurement from '@network-scan/domain/organization/OrganizationMeasurement.js';
import type { OrganizationTomlAttempt } from '@network-scan/domain/organization/scan/OrganizationTomlAttempt.js';
import { TOML_TLS_CERTIFICATE_WARNING } from '@network-scan/domain/network/scan/TomlService.js';

export const ORGANIZATION_TOML_ATTEMPT_RETENTION = 256;
const CONTENT_CLEANUP_BATCH_SIZE = 128;

interface SequenceRow {
	readonly sequence: unknown;
}

interface AttemptRow extends SequenceRow {
	readonly authoritative: unknown;
	readonly contentHash: unknown;
	readonly observedAt: unknown;
	readonly result: unknown;
	readonly scanRunId: unknown;
	readonly source: unknown;
	readonly state: unknown;
	readonly warnings: unknown;
}

interface MeasurementRow extends SequenceRow {
	readonly index: unknown;
	readonly isSubQuorumAvailable: unknown;
	readonly scanRunId: unknown;
	readonly tomlFetchResult: unknown;
	readonly tomlState: unknown;
	readonly tomlWarnings: unknown;
}

export interface OrganizationMeasurementPersistenceHooks {
	readonly afterProvenanceAllocated?: (sequence: string) => Promise<void>;
}

export async function saveOrganizationMeasurement(
	entityManager: EntityManager,
	organization: Organization,
	measurement: OrganizationMeasurement,
	hooks: OrganizationMeasurementPersistenceHooks = {}
): Promise<void> {
	if (organization.id === undefined) {
		throw new Error('Cannot persist a measurement without organization id');
	}

	const attempt = quarantineInsecureAttempt(measurement.toTomlAttempt());
	if (attempt !== null) {
		measurement.tomlAttemptAuthoritative = attempt.authoritative;
	}
	const contentHash = await persistAttemptContent(entityManager, attempt);
	const sequence =
		attempt === null
			? await allocateProvenanceSequence(entityManager)
			: await insertIdempotentTomlAttempt(
					entityManager,
					organization.id,
					attempt,
					contentHash
				);
	await hooks.afterProvenanceAllocated?.(sequence);

	await upsertMeasurement(
		entityManager,
		organization.id,
		measurement,
		sequence
	);
	measurement.tomlEvidenceSequence = sequence;

	if (attempt !== null) {
		await upsertTomlSnapshot(
			entityManager,
			organization.id,
			attempt,
			sequence,
			contentHash
		);
		await enforceOrganizationTomlRetention(entityManager, organization.id);
	}
}

async function persistAttemptContent(
	entityManager: EntityManager,
	attempt: OrganizationTomlAttempt | null
): Promise<string | null> {
	if (attempt?.authoritative && attempt.result !== 'success') {
		throw new Error('Failed TOML attempts cannot be authoritative');
	}
	if (attempt === null || attempt.content === null) {
		if (attempt?.result === 'success') {
			throw new Error(
				'Successful TOML attempt is missing its exact response body'
			);
		}
		return null;
	}
	const hash = createHash('sha256')
		.update(attempt.content, 'utf8')
		.digest('hex');
	await entityManager.query(
		`select pg_advisory_xact_lock(hashtextextended($1, 0))`,
		[hash]
	);
	const rows = (await entityManager.query(
		`
			with inserted as (
				insert into "organization_toml_content" (
					"hash", "byteLength", "content"
				)
				values ($1, $2, $3)
				on conflict ("hash") do nothing
				returning "content"
			)
			select "content" from inserted
			union all
			select "content" from "organization_toml_content" where "hash" = $1
			limit 1
		`,
		[hash, Buffer.byteLength(attempt.content, 'utf8'), attempt.content]
	)) as Array<{ content: unknown }>;
	if (rows[0]?.content !== attempt.content) {
		throw new Error('TOML content hash collision or persistence failure');
	}
	return hash;
}

async function insertIdempotentTomlAttempt(
	entityManager: EntityManager,
	organizationId: number,
	attempt: OrganizationTomlAttempt,
	contentHash: string | null
): Promise<string> {
	const parameters = [
		organizationId,
		attempt.runId,
		attempt.observedAt,
		attempt.result,
		attempt.state,
		JSON.stringify(attempt.warnings),
		attempt.authoritative,
		contentHash
	];
	let rows: AttemptRow[] = [];
	for (let tryNumber = 0; tryNumber < 2 && rows.length === 0; tryNumber++) {
		rows = (await entityManager.query(
			`
				with inserted as (
					insert into "organization_toml_attempt" (
						"organizationId", "scanRunId", "observedAt", "result",
						"state", "warnings", "authoritative", "contentHash",
						"source"
					)
					values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, 'network_scan')
					on conflict ("organizationId", "scanRunId") do nothing
					returning *
				)
				select "sequence"::text as "sequence", "scanRunId", "observedAt",
					"result", "state", "warnings", "authoritative", "contentHash",
					"source"
				from inserted
				union all
				select "sequence"::text as "sequence", "scanRunId", "observedAt",
					"result", "state", "warnings", "authoritative", "contentHash",
					"source"
				from "organization_toml_attempt"
				where "organizationId" = $1 and "scanRunId" = $2
				limit 1
			`,
			parameters
		)) as AttemptRow[];
	}
	const row = rows[0];
	if (row === undefined) {
		throw new Error('PostgreSQL did not return TOML attempt provenance');
	}
	assertIdempotentAttempt(row, attempt, contentHash);
	return requireSequence(row.sequence);
}

function assertIdempotentAttempt(
	row: AttemptRow,
	attempt: OrganizationTomlAttempt,
	contentHash: string | null
): void {
	const observedAt =
		row.observedAt instanceof Date
			? row.observedAt
			: new Date(String(row.observedAt));
	const matches =
		row.scanRunId === attempt.runId &&
		observedAt.getTime() === attempt.observedAt.getTime() &&
		row.result === attempt.result &&
		row.state === attempt.state &&
		JSON.stringify(row.warnings) === JSON.stringify(attempt.warnings) &&
		row.authoritative === attempt.authoritative &&
		row.contentHash === contentHash &&
		row.source === 'network_scan';
	if (!matches) {
		throw new Error(`Conflicting TOML evidence for scan run ${attempt.runId}`);
	}
}

async function allocateProvenanceSequence(
	entityManager: EntityManager
): Promise<string> {
	const rows = (await entityManager.query(`
		select nextval(
			pg_get_serial_sequence('organization_toml_attempt', 'sequence')
		)::text as "sequence"
	`)) as SequenceRow[];
	return requireSequence(rows[0]?.sequence);
}

function requireSequence(value: unknown): string {
	const sequence = String(value);
	if (!/^[1-9][0-9]*$/.test(sequence)) {
		throw new Error('Invalid TOML evidence provenance sequence');
	}
	return sequence;
}

async function upsertMeasurement(
	entityManager: EntityManager,
	organizationId: number,
	measurement: OrganizationMeasurement,
	sequence: string
): Promise<void> {
	await entityManager.query(
		`
			insert into "organization_measurement" (
				"time", "organizationId", "isSubQuorumAvailable", "index",
				"tomlState", "tomlWarnings", "tomlFetchResult",
				"tomlEvidenceSequence", "scanRunId"
			)
			values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::bigint, $9)
			on conflict ("time", "organizationId") do update set
				"isSubQuorumAvailable" = excluded."isSubQuorumAvailable",
				"index" = excluded."index",
				"tomlState" = excluded."tomlState",
				"tomlWarnings" = excluded."tomlWarnings",
				"tomlFetchResult" = excluded."tomlFetchResult",
				"tomlEvidenceSequence" = excluded."tomlEvidenceSequence",
				"scanRunId" = excluded."scanRunId"
			where "organization_measurement"."tomlEvidenceSequence" is null
				or (
					"organization_measurement"."time",
					"organization_measurement"."tomlEvidenceSequence"
				) < (excluded."time", excluded."tomlEvidenceSequence")
		`,
		[
			measurement.time,
			organizationId,
			measurement.isSubQuorumAvailable,
			measurement.index,
			measurement.tomlState,
			JSON.stringify(measurement.tomlWarnings),
			measurement.tomlFetchResult,
			sequence,
			measurement.scanRunId
		]
	);
	await assertEqualSequenceMeasurement(
		entityManager,
		organizationId,
		measurement,
		sequence
	);
}

async function assertEqualSequenceMeasurement(
	entityManager: EntityManager,
	organizationId: number,
	measurement: OrganizationMeasurement,
	sequence: string
): Promise<void> {
	const rows = (await entityManager.query(
		`select "tomlEvidenceSequence"::text as "sequence",
			"isSubQuorumAvailable", "index", "tomlState", "tomlWarnings",
			"tomlFetchResult", "scanRunId"
		 from "organization_measurement"
		 where "organizationId" = $1 and "time" = $2`,
		[organizationId, measurement.time]
	)) as MeasurementRow[];
	const row = rows[0];
	if (row === undefined)
		throw new Error('Organization measurement was not stored');
	if (requireSequence(row.sequence) !== sequence) return;

	const matches =
		row.isSubQuorumAvailable === measurement.isSubQuorumAvailable &&
		row.index === measurement.index &&
		row.tomlState === measurement.tomlState &&
		JSON.stringify(row.tomlWarnings) ===
			JSON.stringify(measurement.tomlWarnings) &&
		row.tomlFetchResult === measurement.tomlFetchResult &&
		row.scanRunId === measurement.scanRunId;
	if (!matches) {
		throw new Error(
			`Conflicting organization measurement for TOML provenance ${sequence}`
		);
	}
}

export async function upsertTomlSnapshot(
	entityManager: EntityManager,
	organizationId: number,
	attempt: OrganizationTomlAttempt,
	sequence: string,
	contentHash: string | null
): Promise<void> {
	attempt = quarantineInsecureAttempt(attempt);
	const values = [
		organizationId,
		attempt.observedAt,
		sequence,
		attempt.result,
		attempt.state,
		JSON.stringify(attempt.warnings),
		attempt.authoritative,
		contentHash,
		attempt.runId
	];
	await entityManager.query(
		`
			insert into "organization_toml_snapshot" (
				"organizationId", "latestAttemptObservedAt",
				"latestAttemptSequence", "latestAttemptRunId", "latestAttemptResult",
				"latestAttemptState", "latestAttemptWarnings",
				"latestAttemptAuthoritative", "latestAttemptContentHash"
			)
			values ($1, $2, $3::bigint, $9, $4, $5, $6::jsonb, $7, $8)
			on conflict ("organizationId") do nothing
		`,
		values
	);
	await updateSnapshotGroup(entityManager, 'Attempt', values);
	if (attempt.authoritative && attempt.result === 'success') {
		await updateSnapshotGroup(entityManager, 'Success', values);
	}
	if (attempt.result === 'failure') {
		await updateSnapshotGroup(entityManager, 'Failure', values);
	}
	if (attempt.warnings.includes(TOML_TLS_CERTIFICATE_WARNING)) {
		await updateSnapshotGroup(entityManager, 'Insecure', values);
	}
}

async function updateSnapshotGroup(
	entityManager: EntityManager,
	group: 'Attempt' | 'Failure' | 'Insecure' | 'Success',
	values: unknown[]
): Promise<void> {
	const assignments = {
		Attempt: `
			"latestAttemptObservedAt" = $2,
			"latestAttemptSequence" = $3::bigint,
			"latestAttemptRunId" = $9,
			"latestAttemptResult" = $4,
			"latestAttemptState" = $5,
			"latestAttemptWarnings" = $6::jsonb,
			"latestAttemptAuthoritative" = $7,
			"latestAttemptContentHash" = $8`,
		Success: `
				"latestSuccessObservedAt" = $2,
				"latestSuccessSequence" = $3::bigint,
				"latestSuccessAuthoritative" = $7,
				"latestSuccessContentHash" = $8,
			"latestSuccessWarnings" = $6::jsonb`,
		Failure: `
			"latestFailureObservedAt" = $2,
			"latestFailureSequence" = $3::bigint,
			"latestFailureRunId" = $9,
			"latestFailureState" = $5,
			"latestFailureWarnings" = $6::jsonb,
			"latestFailureContentHash" = $8`,
		Insecure: `
			"latestInsecureObservedAt" = $2,
			"latestInsecureSequence" = $3::bigint,
			"latestInsecureRunId" = $9,
			"latestInsecureResult" = $4,
			"latestInsecureState" = $5,
			"latestInsecureWarnings" = $6::jsonb,
			"latestInsecureContentHash" = $8`
	}[group];
	await entityManager.query(
		`
			with incoming as (
				select $2::timestamptz, $3::bigint, $4::text, $5::text,
					$6::jsonb, $7::boolean, $8::char(64), $9::text
			)
			update "organization_toml_snapshot"
			set ${assignments}, "updatedAt" = now()
			where "organizationId" = $1
				and (
					"latest${group}ObservedAt" is null
					or ("latest${group}ObservedAt", "latest${group}Sequence") <
						($2, $3::bigint)
				)
		`,
		values
	);
}

function quarantineInsecureAttempt(
	attempt: OrganizationTomlAttempt
): OrganizationTomlAttempt;
function quarantineInsecureAttempt(attempt: null): null;
function quarantineInsecureAttempt(
	attempt: OrganizationTomlAttempt | null
): OrganizationTomlAttempt | null;
function quarantineInsecureAttempt(
	attempt: OrganizationTomlAttempt | null
): OrganizationTomlAttempt | null {
	if (
		attempt === null ||
		!attempt.authoritative ||
		!attempt.warnings.includes(TOML_TLS_CERTIFICATE_WARNING)
	) {
		return attempt;
	}
	return { ...attempt, authoritative: false };
}

export async function enforceOrganizationTomlRetention(
	entityManager: EntityManager,
	organizationId: number
): Promise<void> {
	await entityManager.query(
		`
			with retained as (
				(
					select "sequence"
					from "organization_toml_attempt"
					where "organizationId" = $1
					order by "observedAt" desc, "sequence" desc
					limit $2
				)
				union
				select unnest(array[
					"latestAttemptSequence", "latestSuccessSequence",
					"latestFailureSequence", "latestInsecureSequence"
				])
				from "organization_toml_snapshot"
				where "organizationId" = $1
			)
			delete from "organization_toml_attempt" attempt
			where attempt."organizationId" = $1
				and not exists (
					select 1 from retained where retained."sequence" = attempt."sequence"
				)
		`,
		[organizationId, ORGANIZATION_TOML_ATTEMPT_RETENTION]
	);
	await entityManager.query(
		`
			with orphaned as (
				select content."hash"
				from "organization_toml_content" content
				where not exists (
					select 1 from "organization_toml_attempt" attempt
					where attempt."contentHash" = content."hash"
				) and not exists (
					select 1 from "organization_toml_snapshot" snapshot
					where content."hash" in (
						snapshot."latestAttemptContentHash",
						snapshot."latestSuccessContentHash",
						snapshot."latestFailureContentHash",
						snapshot."latestInsecureContentHash"
					)
				)
					and pg_try_advisory_xact_lock(
						hashtextextended(content."hash", 0)
					)
				order by content."createdAt", content."hash"
				limit $1
			)
			delete from "organization_toml_content" content
			using orphaned
			where content."hash" = orphaned."hash"
		`,
		[CONTENT_CLEANUP_BATCH_SIZE]
	);
}
