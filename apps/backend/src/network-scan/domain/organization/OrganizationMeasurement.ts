import {
	AfterLoad,
	Check,
	Entity,
	Column,
	ManyToOne,
	PrimaryColumn
} from 'typeorm';
import type Organization from './Organization.js';
import { Measurement } from '../measurement/Measurement.js';
import { TomlState } from './scan/TomlState.js';
import type { TomlFetchWarning } from '../network/scan/TomlService.js';
import type { OrganizationTomlAttempt } from './scan/OrganizationTomlAttempt.js';
import { randomUUID } from 'node:crypto';
import {
	ORGANIZATION_TOML_FETCH_RESULTS,
	type OrganizationTomlFetchResult
} from './scan/OrganizationTomlFetchResult.js';

@Entity()
@Check(
	'CHK_organization_measurement_toml_fetch_result',
	`"tomlFetchResult" IN (${ORGANIZATION_TOML_FETCH_RESULTS.map((result) => `'${result}'`).join(', ')})`
)
export default class OrganizationMeasurement implements Measurement {
	@Column('timestamptz', { primary: true })
	time: Date;

	@PrimaryColumn()
	private organizationId?: string;

	@ManyToOne('Organization', {
		nullable: false,
		eager: true
	})
	organization: Organization;

	@Column('bool')
	isSubQuorumAvailable = false; //todo: rename to isAvailable

	@Column('smallint')
	index = 0; //future proof

	@Column('enum', { default: TomlState.Unknown, enum: TomlState })
	tomlState: TomlState = TomlState.Unknown;

	@Column('jsonb', { default: () => "'[]'::jsonb" })
	tomlWarnings: TomlFetchWarning[] = [];

	@Column('text', { default: 'not_attempted', nullable: true })
	tomlFetchResult: OrganizationTomlFetchResult = 'not_attempted';

	@Column('bigint', { default: 0, nullable: true })
	tomlEvidenceSequence = '0';

	@Column('text', { nullable: true })
	scanRunId: string | null;

	// Attempt payload is persisted separately from the mutable organization aggregate.
	tomlAttemptContent: string | null = null;
	tomlAttemptAuthoritative = false;

	constructor(
		time: Date,
		organization: Organization,
		scanRunId: string = randomUUID()
	) {
		this.time = time;
		this.organization = organization;
		this.scanRunId = scanRunId;
	}

	@AfterLoad()
	private normalizeHydratedTomlEvidence(): void {
		const result: unknown = this.tomlFetchResult;
		if (!isOrganizationTomlFetchResult(result)) {
			this.resetToUnknownTomlEvidence();
			return;
		}

		const sequence: unknown = this.tomlEvidenceSequence;
		if (typeof sequence !== 'string' || !/^[0-9]+$/.test(sequence)) {
			this.tomlEvidenceSequence = '0';
		}
		if (!isTomlState(this.tomlState)) this.tomlState = TomlState.Unknown;
		if (!isTomlWarnings(this.tomlWarnings)) this.tomlWarnings = [];

		if (
			result !== 'not_attempted' &&
			(typeof this.scanRunId !== 'string' || this.scanRunId.length === 0)
		) {
			this.resetToUnknownTomlEvidence();
		}
	}

	toTomlAttempt(): OrganizationTomlAttempt | null {
		this.normalizeHydratedTomlEvidence();
		if (this.tomlFetchResult === 'not_attempted') return null;

		return {
			authoritative: this.tomlAttemptAuthoritative,
			content: this.tomlAttemptContent,
			observedAt: this.time,
			result: this.tomlFetchResult,
			runId: this.scanRunId!,
			...(this.tomlEvidenceSequence === '0'
				? {}
				: { sequence: this.tomlEvidenceSequence }),
			state: this.tomlState,
			warnings: [...this.tomlWarnings]
		};
	}

	private resetToUnknownTomlEvidence(): void {
		this.tomlFetchResult = 'not_attempted';
		this.tomlEvidenceSequence = '0';
		this.scanRunId = null;
		this.tomlState = TomlState.Unknown;
		this.tomlWarnings = [];
		this.tomlAttemptContent = null;
		this.tomlAttemptAuthoritative = false;
	}
}

function isOrganizationTomlFetchResult(
	value: unknown
): value is OrganizationTomlFetchResult {
	return ORGANIZATION_TOML_FETCH_RESULTS.some((result) => result === value);
}

function isTomlState(value: unknown): value is TomlState {
	return (
		typeof value === 'string' &&
		Object.values(TomlState).includes(value as TomlState)
	);
}

function isTomlWarnings(value: unknown): value is TomlFetchWarning[] {
	return (
		Array.isArray(value) &&
		value.every((warning) => warning === 'TlsCertificateVerificationDisabled')
	);
}
