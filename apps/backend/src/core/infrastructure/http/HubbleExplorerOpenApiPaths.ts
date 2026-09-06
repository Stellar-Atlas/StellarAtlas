import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { readOpenApiRecord } from './OpenApiDocumentProjection.js';
import { maximumTransferLedgerSpan } from '../../../status/infrastructure/http/HubbleTransferValidation.js';
import { explorerIdentifierExamples as examples } from './HubbleExplorerOpenApiExamples.js';
import { hubbleExplorerEntities } from './HubbleExplorerOpenApiSchemas.js';
import {
	exactInteger,
	jsonResponse,
	queryParameter,
	ref,
	text,
	timestamp
} from './HubbleOpenApiSchemas.js';

const windowParameters = [
	queryParameter(
		'min_ledger',
		'Inclusive minimum ledger. Defaults to max_ledger minus 63, or the ledger encoded in an operation/trade ID.',
		{ type: 'integer', minimum: 1, example: 63490364 }
	),
	queryParameter(
		'max_ledger',
		'Inclusive maximum ledger. Defaults to the greatest published parsed ledger, or the ledger encoded in an operation/trade ID.',
		{ type: 'integer', minimum: 1, example: 63490364 }
	),
	queryParameter(
		'start_time',
		'Inclusive UTC ISO timestamp ending in Z. Narrows the selected ledger window; not an all-history date search.',
		timestamp
	),
	queryParameter(
		'end_time',
		'Exclusive UTC ISO timestamp ending in Z.',
		timestamp
	)
];
const pageParameters = [
	queryParameter(
		'limit',
		'Maximum returned rows, with one lookahead row for nextOffset.',
		{ type: 'integer', minimum: 1, maximum: 100, default: 25, example: 10 }
	),
	queryParameter(
		'offset',
		'Zero-based offset. Follow nextOffset with unchanged filters; narrow the window once offset exceeds 10000.',
		{ type: 'integer', minimum: 0, maximum: 10000, default: 0 }
	)
];
const filterNames = {
	operations: ['source_account', 'type'],
	assets: ['asset_code', 'asset_issuer'],
	contracts: [],
	offers: ['seller', 'offer_id', 'selling_asset', 'buying_asset'],
	trades: ['seller', 'buyer', 'selling_asset', 'buying_asset', 'operation_id']
} as const;
const idNames = {
	operations: 'operationId',
	assets: 'asset',
	contracts: 'contractId',
	offers: 'offerId',
	trades: 'tradeId'
} as const;
const idDescriptions = {
	operations:
		'Exact decimal operation TOID; its encoded ledger is used automatically.',
	assets: 'native or URL-encoded CODE:ISSUER.',
	contracts: 'Stellar C-address.',
	offers:
		'Exact decimal offer ID. Detail is the latest observed change within the selected window.',
	trades: 'OPERATION_ID:ORDER, using the exact operation TOID and trade order.'
} as const;
const semantics = {
	operations:
		'Parsed operations with exact identifiers and a bounded transaction-hash relationship. Details are legacy parsed values, not a guarantee of exact amounts; use typed transaction amounts for hash-verified envelope values.',
	assets:
		'Distinct asset identities observed inside the window; not a current global registry or a holder snapshot.',
	contracts:
		'Distinct contract IDs observed in contract-data changes inside the window; exact detail also checks same-window contract events when state is absent. Not a complete deployed-contract registry. Follow the contract events/state routes for evidence.',
	offers:
		'Historical offer changes, including deleted offers. Detail is latest observed in this window, not the current order book. Amount strings retain source Float64 precision; price rational terms remain exact strings.',
	trades:
		'Parsed trade records. Amount strings retain source Float64 precision and are explicitly marked source_float64; price rational terms and operation IDs remain exact strings.'
} as const;
const errors = {
	'400': jsonResponse(
		ref('HubbleError'),
		'Invalid identifier, unsupported filter, range, date or pagination input.'
	),
	'500': jsonResponse(
		ref('HubbleError'),
		'Unexpected query failure (hubble_query_failed); no partial-success response.'
	),
	'503': jsonResponse(
		ref('HubbleError'),
		'Warehouse unavailable or server query budget exhausted; no partial-success response.'
	)
};
export function withHubbleExplorerPaths(
	paths: Readonly<Record<string, OpenApiRecord>>
): Record<string, OpenApiRecord> {
	const result = { ...paths };
	for (const [entity, name] of Object.entries(hubbleExplorerEntities) as [
		keyof typeof hubbleExplorerEntities,
		string
	][]) {
		for (const detail of [false, true]) {
			const path =
				'/v1/analytics/' +
				entity +
				(detail ? '/{' + idNames[entity] + '}' : '');
			const conflict =
				(entity === 'trades' && !detail) || (entity === 'operations' && detail);
			const typedResponse = jsonResponse(
				ref('HubbleExplorer' + name + (detail ? 'Detail' : 'Page')),
				semantics[entity]
			);
			const parameters: OpenApiRecord[] = [
				...(detail
					? [
							{
								in: 'path',
								name: idNames[entity],
								required: true,
								description: idDescriptions[entity],
								schema: { ...text, example: examples[entity] }
							}
						]
					: []),
				...windowParameters.map((parameter) =>
					entity === 'contracts' &&
					['min_ledger', 'max_ledger'].includes(String(parameter.name))
						? {
								...parameter,
								schema: {
									...readOpenApiRecord(parameter.schema),
									example: 63491202
								}
							}
						: parameter
				),
				...(!detail ? pageParameters : []),
				...filterNames[entity].map((filter) =>
					queryParameter(
						filter,
						filter.endsWith('_asset')
							? 'native or CODE:ISSUER.'
							: filter === 'type'
								? 'Exact numeric Stellar operation type code or stored snake_case name (24 or invoke_host_function).'
								: 'Exact ' + filter.replaceAll('_', ' ') + '.',
						['offer_id', 'operation_id'].includes(filter) ? exactInteger : text
					)
				)
			];
			const description =
				semantics[entity] +
				' Only completed matching batch/digest facts are visible. Maximum window span: ' +
				maximumTransferLedgerSpan +
				' ledgers. ' +
				'The default window is the latest 64 parsed ledgers; date filters only narrow it. Check returned window and coverage. ' +
				'Offset pagination is not immutable under backfill; use narrower ledger windows for large histories. ' +
				(detail
					? 'Missing data returns 404 only within the contiguous parsed prefix; otherwise 409 with coverage metadata.'
					: '');
			const operation: OpenApiRecord = {
				operationId:
					(detail ? 'get' : 'list') + 'Parsed' + name + (detail ? '' : 's'),
				summary:
					(detail ? 'Locate a parsed ' : 'List parsed ') +
					(detail ? entity.slice(0, -1) : entity),
				description,
				tags: ['Analytics'],
				security: [],
				parameters,
				responses: {
					'200': typedResponse,
					...errors,
					...(detail
						? {
								'404': jsonResponse(
									ref('HubbleExplorer' + name + 'NotFound'),
									'Not found in the fully ingested selected window.'
								),
								'409': jsonResponse(
									ref('HubbleExplorer' + name + 'NotFound'),
									'Selected window is not known fully ingested; absence is not proof of nonexistence.'
								)
							}
						: {})
				}
			};
			if (!conflict) {
				result[path] = { get: operation };
				continue;
			}
			const previous = readOpenApiRecord(result[path]?.get);
			if (!previous)
				throw new Error('Missing legacy semantic operation: ' + path);
			const previousResponses = readOpenApiRecord(previous.responses)!;
			const legacySchema = readOpenApiRecord(
				readOpenApiRecord(
					readOpenApiRecord(previousResponses['200'])!.content
				)!['application/json']
			)!.schema;
			const oldParameters = previous.parameters as OpenApiRecord[];
			const existingNames = new Set(
				parameters.map((parameter) => parameter.in + ':' + parameter.name)
			);
			result[path] = {
				get: {
					...previous,
					description:
						previous.description +
						' Use view=typed for the additive parsed explorer representation. ' +
						description,
					parameters: [
						...parameters.map((parameter) => ({
							...parameter,
							description:
								(oldParameters.some(
									(old) =>
										old.in === parameter.in && old.name === parameter.name
								)
									? 'Supported in both views; typed bounds described here. '
									: 'Typed only (view=typed). ') + parameter.description
						})),
						...oldParameters
							.filter(
								(parameter) =>
									!existingNames.has(parameter.in + ':' + parameter.name)
							)
							.map((parameter) => ({
								...parameter,
								description:
									'Legacy only; omit view. Rejected with view=typed. ' +
									(parameter.description ?? '')
							})),
						queryParameter(
							'view',
							'Omit to retain the legacy response and limits. typed selects the bounded parsed explorer representation documented here.',
							{ type: 'string', enum: ['typed'], example: 'typed' }
						)
					],
					responses: {
						...previousResponses,
						...readOpenApiRecord(operation.responses),
						'200': jsonResponse(
							{
								oneOf: [
									legacySchema,
									ref('HubbleExplorer' + name + (detail ? 'Detail' : 'Page'))
								]
							},
							'Legacy response when view is omitted; typed explorer response when view=typed.'
						)
					}
				}
			};
		}
	}
	return result;
}
