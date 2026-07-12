import type { TomlFetchWarning } from '../../network/scan/TomlService.js';
import type { OrganizationTomlAttemptResult } from './OrganizationTomlFetchResult.js';
import type { TomlState } from './TomlState.js';

export interface OrganizationTomlAttempt {
	readonly authoritative: boolean;
	readonly content: string | null;
	readonly observedAt: Date;
	readonly result: OrganizationTomlAttemptResult;
	readonly runId: string;
	readonly sequence?: string;
	readonly state: TomlState;
	readonly warnings: TomlFetchWarning[];
}

export interface OrganizationTomlSuccess {
	readonly content: string;
	readonly observedAt: Date | null;
	readonly sequence?: string;
	readonly warnings: TomlFetchWarning[];
}

export interface OrganizationTomlFailure extends OrganizationTomlAttempt {
	readonly result: 'failure';
}

export interface OrganizationTomlEvidence {
	readonly latestAttempt: OrganizationTomlAttempt | null;
	readonly latestFailure: OrganizationTomlFailure | null;
	readonly latestInsecureAttempt: OrganizationTomlAttempt | null;
	readonly latestSuccess: OrganizationTomlSuccess | null;
}

export interface OrganizationTomlEvidenceRecord extends OrganizationTomlEvidence {
	readonly organizationId: string;
}
