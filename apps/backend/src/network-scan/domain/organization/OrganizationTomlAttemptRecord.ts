import {
	Check,
	Column,
	Entity,
	Index,
	PrimaryGeneratedColumn,
	Unique
} from 'typeorm';
import type { TomlFetchWarning } from '../network/scan/TomlService.js';
import type { OrganizationTomlAttemptResult } from './scan/OrganizationTomlFetchResult.js';
import type { TomlState } from './scan/TomlState.js';

@Entity({ name: 'organization_toml_attempt' })
@Index('IDX_organization_toml_attempt_observed', [
	'organizationId',
	'observedAt',
	'sequence'
])
@Unique('UQ_organization_toml_attempt_run', ['organizationId', 'scanRunId'])
@Unique('UQ_organization_toml_attempt_success_provenance', [
	'organizationId',
	'sequence',
	'authoritative',
	'observedAt',
	'contentHash'
])
@Check(
	'CHK_organization_toml_attempt_result',
	`"result" IN ('success', 'failure')`
)
@Check(
	'CHK_organization_toml_attempt_content',
	`NOT "authoritative" OR (
		"result" = 'success' AND "contentHash" IS NOT NULL AND
		NOT ("warnings" ? 'TlsCertificateVerificationDisabled')
	)`
)
@Check(
	'CHK_organization_toml_attempt_warnings',
	`jsonb_typeof("warnings") = 'array' AND
		"warnings" <@ '["TlsCertificateVerificationDisabled"]'::jsonb`
)
export class OrganizationTomlAttemptRecord {
	@PrimaryGeneratedColumn({ type: 'bigint' })
	readonly sequence!: string;

	@Column('integer')
	readonly organizationId!: number;

	@Column('text')
	readonly scanRunId!: string;

	@Column('timestamptz')
	readonly observedAt!: Date;

	@Column('text')
	readonly result!: OrganizationTomlAttemptResult;

	@Column('text')
	readonly state!: TomlState;

	@Column('jsonb', { default: () => "'[]'::jsonb" })
	readonly warnings!: TomlFetchWarning[];

	@Column('boolean', { default: false })
	readonly authoritative!: boolean;

	@Column('char', { length: 64, nullable: true })
	readonly contentHash!: string | null;

	@Column('text', { default: 'network_scan' })
	readonly source!: 'legacy_backfill' | 'network_scan';

	@Column('timestamptz', { default: () => 'now()' })
	readonly createdAt!: Date;
}
