import type { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';

export const ORGANIZATION_TOML_STATES_V1 = [
	'Unknown',
	'Ok',
	'RequestTimeout',
	'DNSLookupFailed',
	'HostnameResolutionFailed',
	'ConnectionTimeout',
	'ConnectionRefused',
	'ConnectionResetByPeer',
	'SocketClosedPrematurely',
	'SocketTimeout',
	'HostUnreachable',
	'NotFound',
	'ParsingError',
	'Forbidden',
	'ServerError',
	'UnsupportedVersion',
	'UnspecifiedError',
	'ValidatorNotSEP20Linked',
	'EmptyValidatorsField'
] as const;

export type OrganizationTomlStateV1 =
	(typeof ORGANIZATION_TOML_STATES_V1)[number];
export type OrganizationTomlAttemptResultV1 = 'success' | 'failure';
export type OrganizationTomlWarningV1 = 'TlsCertificateVerificationDisabled';

export interface OrganizationTomlAttemptV1 {
	authoritative?: boolean;
	contentCaptured?: boolean;
	observedAt: string;
	result: OrganizationTomlAttemptResultV1;
	state: OrganizationTomlStateV1;
	warnings: OrganizationTomlWarningV1[];
}

export interface OrganizationTomlFailureV1 extends OrganizationTomlAttemptV1 {
	result: 'failure';
}

export interface OrganizationV1 {
	id: string;
	name: string | null;
	dba: string | null;
	url: string | null;
	horizonUrl: string | null;
	logo: string | null;
	description: string | null;
	physicalAddress: string | null;
	phoneNumber: string | null;
	keybase: string | null;
	twitter: string | null;
	github: string | null;
	officialEmail: string | null;
	validators: string[];
	subQuorumAvailable: boolean;
	has30DayStats: boolean;
	has24HourStats: boolean;
	subQuorum24HoursAvailability: number;
	subQuorum30DaysAvailability: number;
	homeDomain: string;
	dateDiscovered: string;
	hasReliableUptime: boolean;
	tomlState: string;
	tomlWarnings: string[];
	tomlLatestAttempt?: OrganizationTomlAttemptV1 | null;
	tomlLatestFailure?: OrganizationTomlFailureV1 | null;
	tomlLatestInsecureAttempt?: OrganizationTomlAttemptV1 | null;
	stellarToml: OrganizationStellarTomlV1 | null;
}

export interface OrganizationStellarTomlV1 {
	url: string;
	content: string;
	observedAt?: string;
	warnings?: OrganizationTomlWarningV1[];
}

export const OrganizationV1Schema: JSONSchemaType<OrganizationV1> = {
	$id: 'organization-v1.json',
	$schema: 'http://json-schema.org/draft-07/schema#',
	properties: {
		dateDiscovered: {
			format: 'date-time',
			type: 'string'
		},
		dba: nullable({
			type: 'string'
		}),
		description: nullable({
			type: 'string'
		}),
		github: nullable({
			type: 'string'
		}),
		has24HourStats: {
			type: 'boolean'
		},
		has30DayStats: {
			type: 'boolean'
		},
		horizonUrl: nullable({
			type: 'string'
		}),
		id: {
			type: 'string'
		},
		homeDomain: {
			type: 'string'
		},
		hasReliableUptime: {
			type: 'boolean'
		},
		keybase: nullable({
			type: 'string'
		}),
		logo: nullable({
			type: 'string'
		}),
		name: nullable({
			type: 'string'
		}),
		officialEmail: nullable({
			type: 'string'
		}),
		phoneNumber: nullable({
			type: 'string'
		}),
		physicalAddress: nullable({
			type: 'string'
		}),
		subQuorum24HoursAvailability: {
			type: 'number'
		},
		subQuorum30DaysAvailability: {
			type: 'number'
		},
		subQuorumAvailable: {
			type: 'boolean'
		},
		twitter: nullable({
			type: 'string'
		}),
		url: nullable({
			type: 'string'
		}),
		tomlState: {
			type: 'string'
		},
		tomlWarnings: {
			items: {
				type: 'string'
			},
			type: 'array'
		},
		tomlLatestAttempt: {
			$ref: '#/definitions/OrganizationTomlAttemptV1'
		},
		tomlLatestFailure: {
			$ref: '#/definitions/OrganizationTomlFailureV1'
		},
		tomlLatestInsecureAttempt: {
			$ref: '#/definitions/OrganizationTomlAttemptV1'
		},
		stellarToml: {
			$ref: '#/definitions/OrganizationStellarTomlV1'
		},
		validators: {
			items: {
				type: 'string'
			},
			type: 'array'
		}
	},
	type: 'object',
	required: [
		'id',
		'validators',
		'subQuorumAvailable',
		'has30DayStats',
		'has24HourStats',
		'subQuorum24HoursAvailability',
		'subQuorum30DaysAvailability',
		'dateDiscovered',
		'hasReliableUptime',
		'dba',
		'description',
		'github',
		'horizonUrl',
		'keybase',
		'logo',
		'name',
		'officialEmail',
		'phoneNumber',
		'physicalAddress',
		'twitter',
		'url',
		'homeDomain',
		'tomlState',
		'tomlWarnings',
		'stellarToml'
	],
	definitions: {
		OrganizationTomlAttemptV1: {
			properties: {
				authoritative: {
					type: 'boolean'
				},
				contentCaptured: {
					type: 'boolean'
				},
				observedAt: {
					format: 'date-time',
					type: 'string'
				},
				result: {
					enum: ['success', 'failure'],
					type: 'string'
				},
				state: {
					enum: [...ORGANIZATION_TOML_STATES_V1],
					type: 'string'
				},
				warnings: {
					items: {
						enum: ['TlsCertificateVerificationDisabled'],
						type: 'string'
					},
					type: 'array'
				}
			},
			type: 'object',
			nullable: true,
			required: ['observedAt', 'result', 'state', 'warnings']
		},
		OrganizationTomlFailureV1: {
			properties: {
				authoritative: {
					type: 'boolean'
				},
				contentCaptured: {
					type: 'boolean'
				},
				observedAt: {
					format: 'date-time',
					type: 'string'
				},
				result: {
					enum: ['failure'],
					type: 'string'
				},
				state: {
					enum: [...ORGANIZATION_TOML_STATES_V1],
					type: 'string'
				},
				warnings: {
					items: {
						enum: ['TlsCertificateVerificationDisabled'],
						type: 'string'
					},
					type: 'array'
				}
			},
			type: 'object',
			nullable: true,
			required: ['observedAt', 'result', 'state', 'warnings']
		},
		OrganizationStellarTomlV1: {
			properties: {
				content: {
					type: 'string'
				},
				observedAt: {
					format: 'date-time',
					type: 'string'
				},
				url: {
					type: 'string'
				},
				warnings: {
					items: {
						enum: ['TlsCertificateVerificationDisabled'],
						type: 'string'
					},
					type: 'array'
				}
			},
			type: 'object',
			nullable: true,
			required: ['content', 'url']
		}
	}
};
