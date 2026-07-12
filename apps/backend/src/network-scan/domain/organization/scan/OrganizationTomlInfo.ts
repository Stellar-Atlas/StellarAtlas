import { TomlState } from './TomlState.js';
import type { TomlFetchWarning } from '../../network/scan/TomlService.js';
import type { OrganizationTomlAttemptResult } from './OrganizationTomlFetchResult.js';

interface OrganizationTomlInfoBase {
	authoritative: boolean;
	state: TomlState;
	warnings: TomlFetchWarning[];
	name: string | null;
	physicalAddress: string | null;
	twitter: string | null;
	github: string | null;
	keybase: string | null;
	officialEmail: string | null;
	horizonUrl: string | null;
	dba: string | null;
	url: string | null;
	description: string | null;
	phoneNumber: string | null;
	validators: string[];
	validatorSetValid: boolean;
}

export type OrganizationTomlInfo = OrganizationTomlInfoBase &
	(
		| {
				fetchResult: Extract<OrganizationTomlAttemptResult, 'success'>;
				stellarTomlText: string;
		  }
		| {
				fetchResult: Extract<OrganizationTomlAttemptResult, 'failure'>;
				stellarTomlText: string | null;
		  }
	);
