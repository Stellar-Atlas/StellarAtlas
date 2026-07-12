import { Check, Column, Entity, PrimaryColumn } from 'typeorm';
import type { TomlFetchWarning } from '../network/scan/TomlService.js';
import type { OrganizationTomlAttemptResult } from './scan/OrganizationTomlFetchResult.js';
import type { TomlState } from './scan/TomlState.js';

@Entity({ name: 'organization_toml_snapshot' })
@Check(
	'CHK_organization_toml_snapshot_attempt_result',
	`"latestAttemptResult" IN ('success', 'failure')`
)
@Check(
	'CHK_organization_toml_snapshot_attempt_authority',
	`NOT "latestAttemptAuthoritative" OR
		NOT ("latestAttemptWarnings" ? 'TlsCertificateVerificationDisabled')`
)
@Check(
	'CHK_organization_toml_snapshot_success',
	`(
		"latestSuccessSequence" IS NULL AND
		"latestSuccessObservedAt" IS NULL AND
		"latestSuccessAuthoritative" IS NULL AND
		"latestSuccessContentHash" IS NULL AND
		"latestSuccessWarnings" IS NULL
	) OR (
		"latestSuccessSequence" IS NOT NULL AND
		"latestSuccessObservedAt" IS NOT NULL AND
		"latestSuccessAuthoritative" IS TRUE AND
		"latestSuccessContentHash" IS NOT NULL AND
		"latestSuccessWarnings" = '[]'::jsonb
	)`
)
export class OrganizationTomlSnapshot {
	@PrimaryColumn('integer')
	readonly organizationId!: number;

	@Column('timestamptz')
	readonly latestAttemptObservedAt!: Date;

	@Column('bigint')
	readonly latestAttemptSequence!: string;

	@Column('text')
	readonly latestAttemptRunId!: string;

	@Column('text')
	readonly latestAttemptResult!: OrganizationTomlAttemptResult;

	@Column('text')
	readonly latestAttemptState!: TomlState;

	@Column('jsonb')
	readonly latestAttemptWarnings!: TomlFetchWarning[];

	@Column('boolean')
	readonly latestAttemptAuthoritative!: boolean;

	@Column('char', { length: 64, nullable: true })
	readonly latestAttemptContentHash!: string | null;

	@Column('timestamptz', { nullable: true })
	readonly latestSuccessObservedAt!: Date | null;

	@Column('bigint', { nullable: true })
	readonly latestSuccessSequence!: string | null;

	@Column('boolean', { nullable: true })
	readonly latestSuccessAuthoritative!: boolean | null;

	@Column('char', { length: 64, nullable: true })
	readonly latestSuccessContentHash!: string | null;

	@Column('jsonb', { nullable: true })
	readonly latestSuccessWarnings!: TomlFetchWarning[] | null;

	@Column('timestamptz', { nullable: true })
	readonly latestFailureObservedAt!: Date | null;

	@Column('bigint', { nullable: true })
	readonly latestFailureSequence!: string | null;

	@Column('text', { nullable: true })
	readonly latestFailureRunId!: string | null;

	@Column('text', { nullable: true })
	readonly latestFailureState!: TomlState | null;

	@Column('jsonb', { nullable: true })
	readonly latestFailureWarnings!: TomlFetchWarning[] | null;

	@Column('char', { length: 64, nullable: true })
	readonly latestFailureContentHash!: string | null;

	@Column('timestamptz', { nullable: true })
	readonly latestInsecureObservedAt!: Date | null;

	@Column('bigint', { nullable: true })
	readonly latestInsecureSequence!: string | null;

	@Column('text', { nullable: true })
	readonly latestInsecureRunId!: string | null;

	@Column('text', { nullable: true })
	readonly latestInsecureResult!: OrganizationTomlAttemptResult | null;

	@Column('text', { nullable: true })
	readonly latestInsecureState!: TomlState | null;

	@Column('jsonb', { nullable: true })
	readonly latestInsecureWarnings!: TomlFetchWarning[] | null;

	@Column('char', { length: 64, nullable: true })
	readonly latestInsecureContentHash!: string | null;

	@Column('timestamptz', { default: () => 'now()' })
	readonly createdAt!: Date;

	@Column('timestamptz', { default: () => 'now()' })
	readonly updatedAt!: Date;
}
