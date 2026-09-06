import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { hubbleTypedEventSchema } from './HubbleTransactionOpenApi.js';
import {
	hubbleCoverageSchema,
	object,
	ref,
	text
} from './HubbleOpenApiSchemas.js';
import {
	defaultTransferLedgerSpan,
	maximumTransferLedgerSpan
} from '../../../status/infrastructure/http/HubbleTransferValidation.js';
const contractId = 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
const description =
	'Set view=typed for parsed events with exact identifiers, retained XDR/decoded JSON, and explicit classification. This includes system, contract, and diagnostic events: execution evidence does not imply success, and a native fee is not Soroban execution evidence. Typed pages use a descending ledger/row/batch/digest cursor tied to all filters and a published watermark. The watermark is not a frozen snapshot: later backfill can add older events. Only completed ingestion batches are visible; coverage gaps are explicit. Omit view to retain the existing raw offset response.';
export const hubbleContractEventSchemas: Record<string, OpenApiRecord> = {
	HubbleTypedContractEventPage: object({
		contractId: {
			type: 'string',
			pattern: '^C[A-Z2-7]{55}$',
			example: contractId
		},
		items: { type: 'array', items: hubbleTypedEventSchema },
		limit: { type: 'integer', minimum: 1, maximum: 200 },
		nextCursor: { type: 'string', nullable: true },
		watermark: object({
			minimumLedger: { type: 'integer', minimum: 0 },
			maximumLedger: { type: 'integer', minimum: 0 },
			observedAt: { type: 'string', format: 'date-time' },
			coverage: { type: 'string', enum: ['ingested-only'] }
		}),
		coverage: hubbleCoverageSchema,
		elapsedMilliseconds: { type: 'number', minimum: 0 }
	})
};
export function withHubbleContractEventPath(
	paths: Record<string, OpenApiRecord>
): Record<string, OpenApiRecord> {
	const path = '/v1/analytics/contracts/{contractId}/events';
	const item = paths[path]!;
	const get = item.get as OpenApiRecord;
	const previous = get.parameters as OpenApiRecord[];
	const parameters = previous.map((parameter) => {
		if (parameter.name === 'offset')
			return {
				...parameter,
				schema: { type: 'integer', minimum: 0 },
				description:
					'Legacy view only; defaults to 0 when omitted. Must be omitted for view=typed: use after instead.'
			};
		if (parameter.name === 'contractId')
			return {
				...parameter,
				schema: {
					type: 'string',
					pattern: '^C[A-Z2-7]{55}$',
					example: contractId
				}
			};
		if (parameter.name === 'min_ledger' || parameter.name === 'max_ledger')
			return {
				...parameter,
				schema: {
					type: 'integer',
					minimum: 1,
					maximum: 2147483647,
					example: 63490364
				},
				description:
					'Inclusive ledger bound. Typed view maximum span: ' +
					maximumTransferLedgerSpan +
					'; default window: ' +
					defaultTransferLedgerSpan +
					' ledgers ending at the published maximum. Date filters additionally constrain this window.'
			};
		return parameter;
	});
	const query = (
		name: string,
		schema: OpenApiRecord,
		description: string
	): OpenApiRecord => ({
		in: 'query',
		name,
		required: false,
		schema,
		description
	});
	parameters.push(
		query(
			'view',
			{ type: 'string', enum: ['typed'], example: 'typed' },
			'Opt into the bounded typed cursor response; omit for legacy compatibility.'
		),
		query(
			'after',
			{ ...text, minLength: 1, maxLength: 2048 },
			'Typed only. Paste nextCursor and preserve all filters; limit may change.'
		),
		query(
			'start_time',
			{ type: 'string', format: 'date-time' },
			'Typed only. Inclusive UTC timestamp ending in Z.'
		),
		query(
			'end_time',
			{ type: 'string', format: 'date-time' },
			'Typed only. Exclusive UTC timestamp ending in Z.'
		),
		query(
			'type_code',
			{ type: 'integer', enum: [0, 1, 2], example: 2 },
			'Typed only: system=0, contract=1, diagnostic=2.'
		),
		query(
			'successful',
			{ type: 'boolean', example: false },
			'Typed only. Transaction success; false selects failed transactions.'
		),
		query(
			'in_successful_contract_call',
			{ type: 'boolean', example: false },
			'Typed only. Stored event call-success flag.'
		)
	);
	const responses = get.responses as OpenApiRecord;
	const ok = responses['200'] as OpenApiRecord;
	const content = ok.content as OpenApiRecord;
	const json = content['application/json'] as OpenApiRecord;
	return {
		...paths,
		[path]: {
			...item,
			get: {
				...get,
				description,
				parameters,
				responses: {
					...responses,
					'200': {
						...ok,
						content: {
							'application/json': {
								...json,
								schema: {
									oneOf: [json.schema, ref('HubbleTypedContractEventPage')]
								}
							}
						}
					},
					'500': {
						description: 'Unexpected bounded query failure.',
						content: { 'application/json': { schema: ref('HubbleError') } }
					}
				}
			}
		}
	};
}
