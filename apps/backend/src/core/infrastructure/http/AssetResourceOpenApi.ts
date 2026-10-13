import {
	readOpenApiRecord,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';

const nullableString = { type: 'string', nullable: true };
const timestamp = { type: 'string', format: 'date-time', nullable: true };
const asset = {
	type: 'object',
	required: ['id', 'kind', 'code', 'issuer', 'contractId'],
	properties: {
		id: { type: 'string' },
		kind: { type: 'string', enum: ['native', 'classic', 'contract'] },
		code: nullableString,
		issuer: nullableString,
		contractId: { type: 'string' },
		name: nullableString,
		logoUrl: nullableString,
		metadataStatus: {
			type: 'string',
			enum: ['pending', 'ready', 'unavailable']
		},
		observed: { type: 'boolean' },
		firstObservedLedger: { type: 'integer', minimum: 1 },
		lastObservedLedger: { type: 'integer', minimum: 1 },
		firstObservedAt: timestamp,
		lastObservedAt: timestamp
	}
};
const metadata = {
	type: 'object',
	required: [
		'status',
		'name',
		'description',
		'homeDomain',
		'tomlUrl',
		'logoUrl',
		'organization',
		'fetchedAt',
		'error'
	],
	properties: {
		status: { type: 'string', enum: ['pending', 'ready', 'unavailable'] },
		name: {
			...nullableString,
			description:
				'Issuer-published TOML name, not a verified classification or endorsement.'
		},
		description: {
			...nullableString,
			description:
				'Issuer-published TOML description. Treat as unverified publisher claims.'
		},
		homeDomain: nullableString,
		tomlUrl: nullableString,
		logoUrl: nullableString,
		organization: {
			type: 'object',
			additionalProperties: { type: 'string' },
			nullable: true
		},
		fields: {
			type: 'object',
			additionalProperties: { type: 'string' },
			description:
				'Scalar fields from the exact issuer/asset CURRENCIES entry, preserved as publisher data.'
		},
		fetchedAt: timestamp,
		error: nullableString
	}
};
const page = {
	type: 'object',
	required: ['data', 'nextCursor', 'coverage', 'generatedAt'],
	properties: {
		data: { type: 'array', items: asset },
		nextCursor: nullableString,
		generatedAt: timestamp,
		semantics: { type: 'string' },
		coverage: {
			type: 'object',
			properties: {
				source: { type: 'string' },
				catalogueReady: { type: 'boolean' },
				maximumObservedLedger: { type: 'integer', nullable: true },
				observedAssetCount: { type: 'integer' }
			}
		}
	}
};
const issuerDirectoryPage = {
	type: 'object',
	required: ['data', 'nextCursor', 'generatedAt', 'domainsReady'],
	properties: {
		data: {
			type: 'array',
			items: {
				type: 'object',
				required: [
					'id',
					'homeDomain',
					'assetCount',
					'firstObservedLedger',
					'lastObservedLedger',
					'links'
				],
				properties: {
					id: { type: 'string', description: 'Issuer G-address.' },
					homeDomain: nullableString,
					assetCount: { type: 'integer', minimum: 0 },
					firstObservedLedger: { type: 'integer', minimum: 1 },
					lastObservedLedger: { type: 'integer', minimum: 1 },
					links: {
						type: 'object',
						required: ['self', 'assets', 'explorer'],
						properties: {
							self: { type: 'string' },
							assets: { type: 'string' },
							explorer: { type: 'string' }
						}
					}
				}
			}
		},
		nextCursor: nullableString,
		generatedAt: timestamp,
		domainsReady: { type: 'boolean' }
	}
};
const assetMetadataBatch = {
	type: 'object',
	required: ['assets'],
	properties: {
		assets: {
			type: 'array',
			items: {
				type: 'object',
				required: [
					'id',
					'kind',
					'contractId',
					'status',
					'name',
					'logoUrl',
					'logoStatus',
					'homeDomain',
					'referenceIdentity',
					'source'
				],
				properties: {
					...asset.properties,
					status: { type: 'string', enum: ['pending', 'ready', 'unavailable'] },
					name: nullableString,
					logoUrl: nullableString,
					logoStatus: {
						type: 'string',
						enum: ['pending', 'ready', 'unavailable']
					},
					homeDomain: nullableString,
					referenceIdentity: nullableString,
					source: nullableString
				}
			}
		}
	}
};
const similarAssets = {
	type: 'object',
	required: ['asset', 'data', 'nextCursor', 'generatedAt', 'semantics'],
	properties: {
		asset,
		data: { type: 'array', items: asset },
		nextCursor: nullableString,
		generatedAt: timestamp,
		semantics: {
			type: 'string',
			enum: ['same-symbol assets; not an assessment of legitimacy']
		}
	}
};
const filter = (
	name: string,
	schema: OpenApiRecord,
	description: string
): OpenApiRecord => ({ name, in: 'query', description, schema });
const listParameters = [
	filter(
		'q',
		{ type: 'string' },
		'Asset code, issuer G address, CODE:ISSUER, or SAC C address.'
	),
	filter(
		'symbol',
		{ type: 'string' },
		'Exact asset code; multiple issuers can match.'
	),
	filter('issuer', { type: 'string' }, 'Checksum-valid issuer G address.'),
	filter(
		'min_ledger',
		{ type: 'integer', minimum: 1 },
		'Include assets whose observed range intersects this inclusive lower bound.'
	),
	filter(
		'max_ledger',
		{ type: 'integer', minimum: 1 },
		'Include assets whose observed range intersects this inclusive upper bound.'
	),
	filter(
		'start_time',
		{ type: 'string', format: 'date-time' },
		'Include assets whose observed range overlaps this inclusive UTC start.'
	),
	filter(
		'end_time',
		{ type: 'string', format: 'date-time' },
		'Include assets whose observed range overlaps this exclusive UTC end.'
	),
	filter(
		'limit',
		{ type: 'integer', minimum: 1, maximum: 100, default: 25 },
		'Page size.'
	),
	filter(
		'cursor',
		{ type: 'string' },
		'Opaque nextCursor from a page with the same filters.'
	)
];
const parameter = (name: string, description: string): OpenApiRecord => ({
	name,
	in: 'path',
	required: true,
	description,
	schema: { type: 'string' }
});
function get(
	operationId: string,
	summary: string,
	description: string,
	parameters: readonly OpenApiRecord[],
	schema: OpenApiRecord,
	responseDescriptions: { invalidRequest?: string; unavailable?: string } = {}
): OpenApiRecord {
	return {
		get: {
			operationId,
			summary,
			description,
			tags: ['Assets'],
			security: [],
			parameters,
			responses: {
				'200': {
					description: 'Published asset data or metadata cache status.',
					content: { 'application/json': { schema } }
				},
				'400': {
					description:
						responseDescriptions.invalidRequest ??
						'Invalid identifier, filter, or cursor.'
				},
				'503': {
					description:
						responseDescriptions.unavailable ??
						'Asset catalogue temporarily unavailable.'
				}
			}
		}
	};
}

/** Object route aliases inherit the reviewed schemas; discovery has its own contract. */
export function withAssetResourceOpenApiPaths(
	document: unknown
): OpenApiRecord {
	const source = readOpenApiRecord(document) ?? {},
		paths = { ...(readOpenApiRecord(source.paths) ?? {}) };
	for (const [path, item] of Object.entries(paths)) {
		if (
			!/^\/v1\/analytics\/(accounts|assets|contracts|transactions|operations|transfers|activity|trades|offers|ledgers|liquidity-pools)(\/|$)/.test(
				path
			)
		)
			continue;
		if (
			[
				'/v1/analytics/assets',
				'/v1/analytics/assets/{asset}',
				'/v1/analytics/assets/holders'
			].includes(path)
		)
			continue;
		const record = readOpenApiRecord(item),
			operation = readOpenApiRecord(record?.get);
		if (!operation || typeof operation.operationId !== 'string') continue;
		const resourcePath = path.replace('/v1/analytics/', '/v1/'),
			normalizedResourcePath = normalizeTemplatedPath(resourcePath),
			conflictingPath = Object.keys(paths).find(
				(candidate) =>
					candidate !== path &&
					!candidate.startsWith('/v1/analytics/') &&
					normalizeTemplatedPath(candidate) === normalizedResourcePath
			);
		if (
			conflictingPath &&
			(resourcePath === conflictingPath ||
				!(
					resourcePath === '/v1/transactions/{hash}' &&
					conflictingPath !== '/v1/transactions/{hash}'
				))
		)
			continue;
		if (conflictingPath) delete paths[conflictingPath];
		paths[resourcePath] = {
			get: {
				...operation,
				operationId: operation.operationId + 'Resource',
				description:
					String(operation.description ?? '') +
					' Object route backed by the parsed StellarAtlas warehouse.'
			}
		};
	}
	const ref = parameter(
		'asset',
		'Use native/XLM, CODE:ISSUER, CODE-ISSUER, CODE_ISSUER, reversed issuer/code, or a checksum-valid C address. A bare symbol returns paginated matches. SAC mapping is network-specific and does not establish deployment.'
	);
	paths['/v1/assets'] = get(
		'listAssetResources',
		'Discover assets',
		'Search the compact catalogue of asset identities across published history, independent of a recent ledger window. First/last observations do not establish creation time or complete historical coverage. Temporal filters overlap recorded observation bounds.',
		listParameters,
		page
	);
	paths['/v1/assets/{asset}'] = get(
		'getAssetResource',
		'Resolve an asset',
		'Resolve aliases and known SAC addresses to one canonical asset. A bare symbol returns matches from all issuers. Unclassified C addresses are contract references and do not establish token compliance.',
		[
			ref,
			...listParameters.filter((value) =>
				['limit', 'cursor'].includes(String(value.name))
			)
		],
		{
			oneOf: [
				{
					type: 'object',
					required: ['asset', 'metadata', 'links'],
					properties: {
						asset,
						metadata,
						links: {
							type: 'object',
							additionalProperties: { type: 'string', nullable: true }
						}
					}
				},
				{ type: 'object', required: ['matches'], properties: { matches: page } }
			]
		}
	);
	paths['/v1/assets/{asset}/metadata'] = get(
		'getAssetResourceMetadata',
		'Read asset metadata',
		'Issuer-published SEP-1 metadata. A cache miss returns pending while a bounded background refresh retrieves TOML and a safe cached logo. Metadata attribution is not an endorsement.',
		[ref],
		{ type: 'object', properties: { asset, metadata } }
	);
	paths['/v1/asset-metadata'] = get(
		'listAssetMetadataBatch',
		'Read metadata for several assets',
		'Reads cached or pending issuer-published metadata for up to 16 exact asset references. Pass assets as a JSON-encoded string array; ambiguous symbols are rejected. TOML fields are publisher claims, not verified facts.',
		[
			filter(
				'assets',
				{ type: 'string', maxLength: 8192 },
				'JSON-encoded array of up to 16 asset references.'
			)
		],
		assetMetadataBatch,
		{
			invalidRequest: 'Invalid asset reference list.',
			unavailable: 'Asset metadata is temporarily unavailable.'
		}
	);
	paths['/v1/assets/{asset}/similar'] = get(
		'listSimilarAssetResources',
		'Find same-symbol assets',
		'Returns other classic assets with the same code from the published catalogue. Similarity is not an assessment of legitimacy.',
		[
			ref,
			filter(
				'limit',
				{ type: 'integer', minimum: 1, maximum: 100, default: 25 },
				'Page size.'
			),
			filter(
				'cursor',
				{ type: 'string', maxLength: 2048 },
				'Opaque cursor from a page with the same asset.'
			)
		],
		similarAssets,
		{
			invalidRequest: 'Invalid or ambiguous asset reference or cursor.',
			unavailable: 'Asset catalogue temporarily unavailable.'
		}
	);
	const issuer = parameter('issuer', 'Checksum-valid issuer G address.');
	paths['/v1/issuers'] = get(
		'listIssuerResources',
		'Discover issuers',
		'Search the compact issuer directory by a home-domain substring or issuer G-address prefix. The first and last ledgers are observed bounds, not issuer creation dates or complete historical coverage.',
		[
			filter(
				'q',
				{ type: 'string' },
				'Home-domain substring or issuer G-address prefix.'
			),
			filter(
				'limit',
				{ type: 'integer', minimum: 1, maximum: 100, default: 25 },
				'Page size.'
			),
			filter('cursor', { type: 'string' }, 'Opaque pagination cursor.')
		],
		issuerDirectoryPage,
		{
			invalidRequest: 'Invalid issuer search scope or pagination cursor.',
			unavailable: 'Issuer directory temporarily unavailable.'
		}
	);
	paths['/v1/issuers/{issuer}'] = get(
		'getIssuerResource',
		'Read issuer details',
		'Issuer home domain, retained TOML documentation, and issued assets from the published catalogue. Metadata can be null while its background refresh runs.',
		[
			issuer,
			...listParameters.filter((value) =>
				['limit', 'cursor'].includes(String(value.name))
			)
		],
		{
			type: 'object',
			required: ['issuer', 'metadata', 'assets', 'links'],
			properties: {
				issuer: {
					type: 'object',
					properties: { id: { type: 'string' }, homeDomain: nullableString }
				},
				metadata: {
					type: 'object',
					nullable: true,
					properties: {
						homeDomain: { type: 'string' },
						tomlUrl: { type: 'string' },
						fields: {
							type: 'object',
							additionalProperties: { type: 'string' }
						},
						fetchedAt: timestamp,
						error: nullableString
					}
				},
				assets: page,
				links: { type: 'object', additionalProperties: { type: 'string' } }
			}
		}
	);
	paths['/v1/issuers/{issuer}/assets'] = get(
		'listIssuerAssetResources',
		'List issuer assets',
		'Paginated asset identities observed for this issuer.',
		[issuer, ...listParameters.filter((value) => value.name !== 'issuer')],
		page
	);
	return { ...source, paths };
}

function normalizeTemplatedPath(path: string): string {
	return path.replace(/\{[^/{}]+\}/g, '{}');
}
