import { StrKey } from '@stellar/stellar-sdk';
import { githubRepository } from '../http/contract-provenance/ContractBuildAttestation.js';
import type {
	BuildStatus,
	ContractProvenance
} from '../http/contract-provenance/ContractProvenanceService.js';

export const developerSubmissionRetentionDays = 30;
export const developerSubmissionLifetimeMs = 2 * 60_000;
export const developerSubmissionIdPattern =
	/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export interface DeveloperSubmissionInput {
	readonly contractId: string;
	readonly repository: string;
	readonly commit: string;
}

export interface DeveloperSubmissionResult {
	readonly status: BuildStatus | 'source_mismatch';
	readonly evidence: ContractProvenance | null;
}

export interface DeveloperSubmission {
	readonly id: string;
	readonly submittedAt: string;
	readonly expiresAt: string;
	readonly networkPassphrase: string;
	readonly request: DeveloperSubmissionInput;
	readonly status: 'checking' | 'completed' | 'unavailable';
	readonly result: DeveloperSubmissionResult | null;
	readonly contractOwnership: 'not_assessed';
	readonly independentReproduction: 'not_assessed';
	readonly securityAudit: 'not_assessed';
}

export class DeveloperSubmissionError extends Error {
	constructor(
		readonly status: number,
		readonly code: string
	) {
		super(code);
	}
}

export interface DeveloperSubmissionStore {
	create(
		subjectId: string,
		key: string,
		input: DeveloperSubmissionInput,
		networkPassphrase: string
	): Promise<{
		readonly created: boolean;
		readonly submission: DeveloperSubmission;
	}>;
	read(subjectId: string, id: string): Promise<DeveloperSubmission | null>;
	finish(
		subjectId: string,
		id: string,
		result: DeveloperSubmissionResult
	): Promise<DeveloperSubmission>;
}

export function parseDeveloperSubmission(
	value: unknown
): DeveloperSubmissionInput {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new DeveloperSubmissionError(400, 'invalid_submission');
	const row = value as Record<string, unknown>;
	if (
		Object.keys(row).length !== 3 ||
		Object.keys(row).some(
			(key) => !['contractId', 'repository', 'commit'].includes(key)
		) ||
		typeof row.contractId !== 'string' ||
		row.contractId.length !== 56 ||
		!StrKey.isValidContract(row.contractId) ||
		typeof row.repository !== 'string' ||
		row.repository.length > 140 ||
		githubRepository('github:' + row.repository) !== row.repository ||
		typeof row.commit !== 'string' ||
		!/^[a-f0-9]{40}$/.test(row.commit)
	)
		throw new DeveloperSubmissionError(400, 'invalid_submission');
	return {
		contractId: row.contractId,
		repository: row.repository.toLowerCase(),
		commit: row.commit
	};
}

export function developerSubmissionResult(
	input: DeveloperSubmissionInput,
	networkPassphrase: string,
	evidence: ContractProvenance
): DeveloperSubmissionResult {
	if (
		evidence.contractId !== input.contractId ||
		evidence.networkPassphrase !== networkPassphrase
	)
		throw new Error(
			'Contract verification observation does not match its request'
		);
	const build = evidence.build;
	if (
		build.status === 'verified' &&
		(!build.record ||
			build.record.repository.toLowerCase() !== input.repository ||
			build.record.commit !== input.commit)
	)
		return { status: 'source_mismatch', evidence };
	return { status: build.status, evidence };
}

export function projectDeveloperSubmission(
	value: DeveloperSubmission
): DeveloperSubmission {
	if (
		value.status === 'checking' &&
		Date.parse(value.submittedAt) + developerSubmissionLifetimeMs <= Date.now()
	)
		return {
			...value,
			status: 'unavailable',
			result: { status: 'unavailable', evidence: null }
		};
	return value;
}
