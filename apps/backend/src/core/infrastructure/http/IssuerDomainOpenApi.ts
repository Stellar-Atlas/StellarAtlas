import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

const string = { type: 'string' };
const nullableString = { ...string, nullable: true };
const timestamp = { ...nullableString, format: 'date-time' };
const flag = { type: 'boolean' };
const accountId = { ...string, pattern: '^G[A-Z2-7]{55}$' };
const coverage = {
	type: 'string',
	enum: ['available', 'partial', 'unavailable']
};
const homeDomain = {
	type: 'object',
	nullable: true,
	required: ['source', 'domain', 'observedAt', 'status'],
	properties: {
		source: { ...string, enum: ['indexed_account_home_domain'] },
		domain: nullableString,
		observedAt: timestamp,
		status: { ...string, enum: ['observed', 'stale', 'unavailable'] }
	}
};
const asset = {
	type: 'object',
	required: ['id', 'code', 'catalogue', 'toml', 'explorer'],
	properties: {
		id: { ...string, description: 'Classic asset reference CODE:ISSUER.' },
		code: { ...string, minLength: 1, maxLength: 12 },
		catalogue: {
			type: 'object',
			nullable: true,
			required: ['lastObservedLedger'],
			properties: { lastObservedLedger: { type: 'integer', minimum: 1 } }
		},
		toml: { ...string, enum: ['listed', 'not_listed', 'unavailable'] },
		explorer: string
	}
};
const account = {
	type: 'object',
	required: [
		'accountId',
		'association',
		'homeDomain',
		'tomlClaims',
		'assets',
		'assetsTruncated',
		'links'
	],
	properties: {
		accountId,
		association: {
			...string,
			enum: [
				'corroborated',
				'mismatch',
				'indexed_only',
				'toml_only',
				'unavailable'
			],
			description:
				'Relationship between available observations and publisher claims.'
		},
		homeDomain,
		tomlClaims: {
			type: 'array',
			maxItems: 2,
			items: { ...string, enum: ['ACCOUNTS', 'CURRENCIES'] }
		},
		assets: { type: 'array', maxItems: 20, items: asset },
		assetsTruncated: flag,
		links: {
			type: 'object',
			required: ['account', 'issuerAssets'],
			properties: { account: string, issuerAssets: string }
		}
	}
};
const schema = {
	type: 'object',
	required: [
		'domain',
		'networkPassphrase',
		'source',
		'homeDomainIndex',
		'catalogue',
		'toml',
		'accounts',
		'accountsTruncated'
	],
	properties: {
		domain: {
			...string,
			maxLength: 253,
			description: 'Canonical lowercase DNS hostname.'
		},
		networkPassphrase: string,
		source: { ...string, enum: ['cached_issuer_domain_evidence'] },
		homeDomainIndex: coverage,
		catalogue: {
			type: 'object',
			required: ['generatedAt', 'status'],
			properties: { generatedAt: timestamp, status: coverage }
		},
		toml: {
			type: 'object',
			required: ['status', 'url', 'fetchedAt', 'accountsIndexed'],
			properties: {
				status: { ...string, enum: ['available', 'stale', 'unavailable'] },
				url: { ...nullableString, format: 'uri' },
				fetchedAt: timestamp,
				accountsIndexed: flag
			}
		},
		accounts: { type: 'array', maxItems: 25, items: account },
		accountsTruncated: flag
	}
};

function errorResponse(description: string, code: string): OpenApiRecord {
	return {
		description,
		content: {
			'application/json': {
				schema: {
					type: 'object',
					required: ['code', 'error'],
					properties: { code: { ...string, enum: [code] }, error: string }
				}
			}
		}
	};
}

export const issuerDomainOpenApiPath = {
	get: {
		operationId: 'getIssuerDomainEvidence',
		tags: ['Assets'],
		summary: 'Look up issuers by DNS hostname',
		description:
			'Returns bounded observations from the cached account home-domain index, materialized classic-asset catalogue, and cached SEP-1 stellar.toml. ' +
			'A cold catalogue is reported as unavailable. Empty and untruncated results describe cache coverage only. ' +
			'TOML associations are publisher claims. This endpoint performs no network lookup.',
		security: [],
		parameters: [
			{
				name: 'domain',
				in: 'path',
				required: true,
				description:
					'Exact ASCII DNS hostname, optionally with a trailing root dot. URL, IP and Soroban Domains inputs are invalid.',
				schema: { ...string, minLength: 3, maxLength: 254 }
			}
		],
		responses: {
			'200': {
				description: 'Cached issuer-domain evidence and coverage.',
				content: { 'application/json': { schema } }
			},
			'400': errorResponse('Invalid issuer hostname.', 'invalid_issuer_domain'),
			'503': errorResponse(
				'Lookup busy or temporarily unavailable.',
				'issuer_domain_evidence_unavailable'
			)
		}
	}
} satisfies OpenApiRecord;
