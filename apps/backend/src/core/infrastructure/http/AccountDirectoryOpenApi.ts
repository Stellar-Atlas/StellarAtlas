import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

export function withAccountDirectoryOpenApiPaths(
	document: OpenApiRecord
): OpenApiRecord {
	const network = {
		name: 'network',
		in: 'query',
		required: true,
		schema: { type: 'string', enum: ['mainnet', 'testnet'] }
	};
	const response = {
		'200': {
			description:
				'Separate attributed imported and Atlas evidence, conflicts and upstream checkpoint.',
			content: {
				'application/json': {
					schema: { type: 'object', additionalProperties: true }
				}
			}
		},
		'400': { description: 'Invalid address, network or search input.' },
		'503': { description: 'Directory storage is unavailable.' }
	};
	const paths = { ...((document.paths as OpenApiRecord) ?? {}) };
	paths['/v1/account-directory'] = {
		get: {
			operationId: 'searchAccountDirectory',
			tags: ['Analytics'],
			summary: 'Search attributed account directory entries',
			description:
				'Available when the directory is enabled. Imported records have unspecified network applicability. Atlas records use the requested network. Conflicting claims remain separate. Results do not assert ownership or verification.',
			parameters: [
				network,
				{
					name: 'q',
					in: 'query',
					required: true,
					schema: { type: 'string', minLength: 3, maxLength: 80 },
					description:
						'Literal address, name or domain prefix with ASCII case folding.'
				},
				{
					name: 'cursor',
					in: 'query',
					schema: { type: 'string' },
					description:
						'Address cursor from the previous page with the same search.'
				},
				{
					name: 'limit',
					in: 'query',
					schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 }
				}
			],
			responses: response
		}
	};
	paths['/v1/account-directory/{address}'] = {
		get: {
			operationId: 'getAccountDirectoryEvidence',
			tags: ['Analytics'],
			summary: 'Read attributed directory evidence for an exact address',
			description:
				'Returns imported evidence or tombstones, separately curated Atlas evidence, conflicts and upstream availability. Missing evidence is distinct from an uninitialized upstream.',
			parameters: [
				network,
				{
					name: 'address',
					in: 'path',
					required: true,
					schema: { type: 'string', pattern: '^[GC][A-Z2-7]{55}$' }
				}
			],
			responses: response
		}
	};
	return { ...document, paths };
}
