import type { EntityManager } from 'typeorm';
import type {
	OrganizationTomlAttempt,
	OrganizationTomlEvidenceRecord,
	OrganizationTomlFailure
} from '@network-scan/domain/organization/scan/OrganizationTomlAttempt.js';
import type { OrganizationTomlAttemptResult } from '@network-scan/domain/organization/scan/OrganizationTomlFetchResult.js';
import { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import {
	TOML_TLS_CERTIFICATE_WARNING,
	type TomlFetchWarning
} from '@network-scan/domain/network/scan/TomlService.js';

interface EvidenceRow {
	readonly [key: string]: unknown;
	readonly organizationId: unknown;
	readonly latestAttemptAuthoritative: unknown;
	readonly latestAttemptContent: unknown;
	readonly latestAttemptObservedAt: unknown;
	readonly latestAttemptResult: unknown;
	readonly latestAttemptRunId: unknown;
	readonly latestAttemptSequence: unknown;
	readonly latestAttemptState: unknown;
	readonly latestAttemptWarnings: unknown;
	readonly latestFailureContent: unknown;
	readonly latestFailureObservedAt: unknown;
	readonly latestFailureRunId: unknown;
	readonly latestFailureSequence: unknown;
	readonly latestFailureState: unknown;
	readonly latestFailureWarnings: unknown;
	readonly latestInsecureAuthoritative: unknown;
	readonly latestInsecureContent: unknown;
	readonly latestInsecureObservedAt: unknown;
	readonly latestInsecureResult: unknown;
	readonly latestInsecureRunId: unknown;
	readonly latestInsecureSequence: unknown;
	readonly latestInsecureState: unknown;
	readonly latestInsecureWarnings: unknown;
	readonly latestSuccessContent: unknown;
	readonly latestSuccessObservedAt: unknown;
	readonly latestSuccessSequence: unknown;
	readonly latestSuccessWarnings: unknown;
}

export async function findOrganizationTomlEvidenceAt(
	entityManager: EntityManager,
	organizationIds: string[],
	at: Date
): Promise<OrganizationTomlEvidenceRecord[]> {
	if (organizationIds.length === 0) return [];
	const records = (await entityManager.query(
		`
			select
				organization."organizationIdValue" as "organizationId",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptObservedAt"
					else attempt."observedAt" end as "latestAttemptObservedAt",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptSequence" else attempt."sequence"
					end::text as "latestAttemptSequence",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptRunId" else attempt."scanRunId"
					end as "latestAttemptRunId",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptResult" else attempt."result"
					end as "latestAttemptResult",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptState" else attempt."state"
					end as "latestAttemptState",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptWarnings" else attempt."warnings"
					end as "latestAttemptWarnings",
				case when snapshot."organizationId" is not null
					then snapshot."latestAttemptAuthoritative"
					else attempt."authoritative" end as "latestAttemptAuthoritative",
				attempt_content."content" as "latestAttemptContent",
				case when snapshot."organizationId" is not null
					then snapshot."latestSuccessObservedAt" else success."observedAt"
					end as "latestSuccessObservedAt",
				case when snapshot."organizationId" is not null
					then snapshot."latestSuccessSequence" else success."sequence"
					end::text as "latestSuccessSequence",
				success_content."content" as "latestSuccessContent",
				case when snapshot."organizationId" is not null
					then snapshot."latestSuccessWarnings" else success."warnings"
					end as "latestSuccessWarnings",
				case when snapshot."organizationId" is not null
					then snapshot."latestFailureObservedAt" else failure."observedAt"
					end as "latestFailureObservedAt",
				case when snapshot."organizationId" is not null
					then snapshot."latestFailureSequence" else failure."sequence"
					end::text as "latestFailureSequence",
				case when snapshot."organizationId" is not null
					then snapshot."latestFailureRunId" else failure."scanRunId"
					end as "latestFailureRunId",
				case when snapshot."organizationId" is not null
					then snapshot."latestFailureState" else failure."state"
					end as "latestFailureState",
				case when snapshot."organizationId" is not null
					then snapshot."latestFailureWarnings" else failure."warnings"
					end as "latestFailureWarnings",
				failure_content."content" as "latestFailureContent",
				case when snapshot."organizationId" is not null
					then snapshot."latestInsecureObservedAt" else insecure."observedAt"
					end as "latestInsecureObservedAt",
				case when snapshot."organizationId" is not null
					then snapshot."latestInsecureSequence" else insecure."sequence"
					end::text as "latestInsecureSequence",
				case when snapshot."organizationId" is not null
					then snapshot."latestInsecureRunId" else insecure."scanRunId"
					end as "latestInsecureRunId",
				case when snapshot."organizationId" is not null
					then snapshot."latestInsecureResult" else insecure."result"
					end as "latestInsecureResult",
				case when snapshot."organizationId" is not null
					then snapshot."latestInsecureState" else insecure."state"
					end as "latestInsecureState",
				case when snapshot."organizationId" is not null
					then snapshot."latestInsecureWarnings" else insecure."warnings"
					end as "latestInsecureWarnings",
				false as "latestInsecureAuthoritative",
				insecure_content."content" as "latestInsecureContent"
			from "organization" organization
			left join "organization_toml_snapshot" snapshot
				on snapshot."organizationId" = organization.id
				and snapshot."latestAttemptObservedAt" <= $1
			left join lateral (
				select candidate.* from "organization_toml_attempt" candidate
				where candidate."organizationId" = organization.id
					and candidate."observedAt" <= $1
				order by candidate."observedAt" desc, candidate."sequence" desc limit 1
			) attempt on snapshot."organizationId" is null
			left join lateral (
				select candidate.* from "organization_toml_attempt" candidate
				where candidate."organizationId" = organization.id
					and candidate."observedAt" <= $1
					and candidate."authoritative" = true
					and candidate."result" = 'success'
					and candidate."contentHash" is not null
				order by candidate."observedAt" desc, candidate."sequence" desc limit 1
			) success on snapshot."organizationId" is null
			left join lateral (
				select candidate.* from "organization_toml_attempt" candidate
				where candidate."organizationId" = organization.id
					and candidate."observedAt" <= $1 and candidate."result" = 'failure'
				order by candidate."observedAt" desc, candidate."sequence" desc limit 1
			) failure on snapshot."organizationId" is null
			left join lateral (
				select candidate.* from "organization_toml_attempt" candidate
				where candidate."organizationId" = organization.id
					and candidate."observedAt" <= $1
					and candidate."warnings" ? 'TlsCertificateVerificationDisabled'
				order by candidate."observedAt" desc, candidate."sequence" desc limit 1
			) insecure on snapshot."organizationId" is null
			left join "organization_toml_content" attempt_content on
				attempt_content."hash" = case when snapshot."organizationId" is not null
					then snapshot."latestAttemptContentHash" else attempt."contentHash" end
			left join "organization_toml_content" success_content on
				success_content."hash" = case when snapshot."organizationId" is not null
					then snapshot."latestSuccessContentHash" else success."contentHash" end
			left join "organization_toml_content" failure_content on
				failure_content."hash" = case when snapshot."organizationId" is not null
					then snapshot."latestFailureContentHash" else failure."contentHash" end
			left join "organization_toml_content" insecure_content on
				insecure_content."hash" = case when snapshot."organizationId" is not null
					then snapshot."latestInsecureContentHash" else insecure."contentHash" end
			where organization."organizationIdValue" = any($2::varchar[])
		`,
		[at, organizationIds]
	)) as EvidenceRow[];
	return records.map(mapEvidence);
}

function mapEvidence(record: EvidenceRow): OrganizationTomlEvidenceRecord {
	if (typeof record.organizationId !== 'string') {
		throw new Error('Invalid organization id in TOML evidence');
	}
	return {
		organizationId: record.organizationId,
		latestAttempt: mapAttempt(record, 'Attempt'),
		latestFailure: mapFailure(record),
		latestInsecureAttempt: mapAttempt(record, 'Insecure'),
		latestSuccess: mapSuccess(record)
	};
}

function mapFailure(record: EvidenceRow): OrganizationTomlFailure | null {
	const attempt = mapAttempt(record, 'Failure');
	if (attempt === null) return null;
	return { ...attempt, result: 'failure' };
}

function mapAttempt(
	record: EvidenceRow,
	group: 'Attempt' | 'Failure' | 'Insecure'
): OrganizationTomlAttempt | null {
	const observedAt = record[`latest${group}ObservedAt`];
	if (observedAt === null || observedAt === undefined) return null;
	const result =
		group === 'Failure' ? 'failure' : record[`latest${group}Result`];
	if (!isAttemptResult(result)) throw new Error('Invalid TOML attempt result');
	const content = record[`latest${group}Content`];
	if (content !== null && typeof content !== 'string') {
		throw new Error('Invalid TOML attempt content');
	}
	return {
		authoritative:
			group === 'Failure'
				? false
				: requireBoolean(record[`latest${group}Authoritative`]),
		content,
		observedAt: requireDate(observedAt),
		result,
		runId: requireString(record[`latest${group}RunId`]),
		sequence: requireSequence(record[`latest${group}Sequence`]),
		state: requireTomlState(record[`latest${group}State`]),
		warnings: requireTomlWarnings(record[`latest${group}Warnings`])
	};
}

function mapSuccess(
	record: EvidenceRow
): OrganizationTomlEvidenceRecord['latestSuccess'] {
	if (
		record.latestSuccessObservedAt === null ||
		record.latestSuccessObservedAt === undefined
	)
		return null;
	if (typeof record.latestSuccessContent !== 'string') {
		throw new Error('Invalid authoritative TOML success content');
	}
	return {
		content: record.latestSuccessContent,
		observedAt: requireDate(record.latestSuccessObservedAt),
		sequence: requireSequence(record.latestSuccessSequence),
		warnings: requireTomlWarnings(record.latestSuccessWarnings)
	};
}

function isAttemptResult(
	value: unknown
): value is OrganizationTomlAttemptResult {
	return value === 'success' || value === 'failure';
}

function requireBoolean(value: unknown): boolean {
	if (typeof value !== 'boolean')
		throw new Error('Invalid TOML authority flag');
	return value;
}

function requireString(value: unknown): string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error('Invalid TOML scan run identity');
	}
	return value;
}

function requireSequence(value: unknown): string {
	const sequence = String(value);
	if (!/^[1-9][0-9]*$/.test(sequence)) {
		throw new Error('Invalid TOML evidence sequence');
	}
	return sequence;
}

function requireDate(value: unknown): Date {
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.getTime()))
		throw new Error('Invalid TOML evidence time');
	return date;
}

function requireTomlState(value: unknown): TomlState {
	if (
		typeof value !== 'string' ||
		!Object.values(TomlState).includes(value as TomlState)
	)
		throw new Error('Invalid TOML state');
	return value as TomlState;
}

function requireTomlWarnings(value: unknown): TomlFetchWarning[] {
	if (!Array.isArray(value)) throw new Error('Invalid TOML warnings');
	if (value.some((warning) => warning !== TOML_TLS_CERTIFICATE_WARNING)) {
		throw new Error('Unknown TOML warning');
	}
	return [...value] as TomlFetchWarning[];
}
