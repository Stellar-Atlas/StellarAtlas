import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import {
	explorerIdentifierExamples,
	explorerRecordExamples
} from './HubbleExplorerOpenApiExamples.js';
import {
	array,
	exactInteger,
	integer,
	nullableText,
	object,
	ref,
	text,
	timestamp
} from './HubbleOpenApiSchemas.js';

const ledger = {
	...integer,
	minimum: 1,
	maximum: 4294967295,
	example: 63490364
};
const identifier = {
	...exactInteger,
	pattern: '^[0-9]+$',
	description:
		'Exact decimal identifier; keep as a string, never a JavaScript number.'
};
const account = {
	...text,
	pattern: '^G[A-Z2-7]{55}$',
	example: explorerRecordExamples.operation.sourceAccount
};
const asset = {
	...object({
		id: {
			...text,
			pattern: '^(native|[A-Za-z0-9]{1,12}:G[A-Z2-7]{55})$',
			example: explorerIdentifierExamples.assets
		},
		type: { ...text, example: 'credit_alphanum4' },
		code: {
			...nullableText,
			maxLength: 12,
			example: 'USDC',
			description: 'Null for native XLM.'
		},
		issuer: {
			...account,
			nullable: true,
			example: explorerIdentifierExamples.assets.split(':')[1],
			description: 'Null for native XLM.'
		}
	}),
	description:
		'An asset identity observed in the selected history window, not a current registry or holder snapshot.',
	example: {
		id: explorerIdentifierExamples.assets,
		type: 'credit_alphanum4',
		code: 'USDC',
		issuer: explorerIdentifierExamples.assets.split(':')[1]
	}
};
const sourceRecord = {
	...object({
		batchId: {
			...text,
			format: 'uuid',
			example: explorerRecordExamples.operation.sourceRecord.batchId
		},
		digest: {
			...text,
			pattern: '^[0-9a-f]{64}$',
			example: explorerRecordExamples.operation.sourceRecord.digest
		},
		rowNumber: {
			...identifier,
			example: explorerRecordExamples.operation.sourceRecord.rowNumber
		}
	}),
	description:
		'Provenance of this parsed row in a completed batch with matching digest.'
};
const shared = {
	ledgerSequence: ledger,
	closedAt: {
		...timestamp,
		example: explorerRecordExamples.operation.closedAt
	},
	sourceRecord
};
const pair = {
	sellingAsset: ref('HubbleExplorerAsset'),
	buyingAsset: ref('HubbleExplorerAsset'),
	amountPrecision: {
		type: 'string',
		enum: ['source_float64'],
		description:
			'Source ETL amount was Float64. String serialization does not recover lost precision; not exact atomic units.'
	}
};
const price = {
	...object({ numerator: exactInteger, denominator: exactInteger }),
	description:
		'Exact source rational terms; divide numerator by denominator only for display.',
	example: explorerRecordExamples.trade.price
};
const metadata = (entity: string): OpenApiRecord => ({
	entity: { type: 'string', enum: [entity] },
	window: object({
		minLedger: {
			...ledger,
			example: entity === 'contracts' ? 63491202 : 63490364
		},
		maxLedger: {
			...ledger,
			example: entity === 'contracts' ? 63491202 : 63490364
		}
	}),
	coverage: ref('HubbleLedgerCoverage'),
	coverageStatus: {
		type: 'string',
		enum: ['complete', 'partial_or_unknown'],
		example: 'partial_or_unknown',
		description:
			'Complete only when every ledger in the selected window lies inside a completed manifest interval, including supplemental intervals. The global coverage can still contain gaps outside that window.'
	},
	source: { type: 'string', enum: ['stellar_hubble'] },
	semantics: {
		...text,
		example:
			'Historical observations in the selected ledger window; not current-chain state.'
	}
});
export const hubbleExplorerEntities = {
	operations: 'Operation',
	assets: 'Asset',
	contracts: 'Contract',
	offers: 'Offer',
	trades: 'Trade'
} as const;
export const hubbleExplorerSchemas: Record<string, OpenApiRecord> = {
	HubbleExplorerAsset: asset,
	HubbleExplorerContract: {
		...object({
			id: {
				...text,
				pattern: '^C[A-Z2-7]{55}$',
				example: explorerIdentifierExamples.contracts
			}
		}),
		description:
			'Observed contract identity. The documented state example uses ledger 63491202; not a complete deployed-contract registry.'
	},
	HubbleExplorerOperation: object({
		...shared,
		id: { ...identifier, example: explorerRecordExamples.operation.id },
		transactionId: {
			...identifier,
			example: explorerRecordExamples.operation.transactionId
		},
		transactionHash: {
			...nullableText,
			pattern: '^[0-9a-f]{64}$',
			example: explorerRecordExamples.operation.transactionHash,
			description:
				'Resolved from a matching completed parsed transaction row; null if unavailable.'
		},
		sourceAccount: account,
		type: { ...text, example: 'invoke_host_function' },
		typeCode: { ...integer, minimum: 0, example: 24 },
		details: {
			example: explorerRecordExamples.operation.details,
			description:
				'Operation-specific parsed details; the example is a decoded contract invocation with its address, method, arguments and touched ledger keys. May contain rounded legacy amounts; use typed transaction amounts for exact envelope-derived values.'
		}
	}),
	HubbleExplorerOffer: {
		...object({
			...shared,
			...pair,
			id: { ...identifier, example: explorerRecordExamples.offer.id },
			seller: account,
			amount: { ...text, example: explorerRecordExamples.offer.amount },
			price,
			deleted: { type: 'boolean', example: false },
			lastModifiedLedger: ledger
		}),
		description:
			'Historical offer change in the selected window, not the current order book.',
		example: explorerRecordExamples.offer
	},
	HubbleExplorerTrade: {
		...object({
			...shared,
			...pair,
			id: {
				...text,
				pattern: '^[0-9]+:[0-9]+$',
				example: explorerRecordExamples.trade.id
			},
			operationId: {
				...identifier,
				example: explorerRecordExamples.trade.operationId
			},
			order: { ...integer, minimum: 0, example: 0 },
			seller: { ...account, nullable: true },
			buyer: { ...account, nullable: true },
			sellingAmount: {
				...text,
				example: explorerRecordExamples.trade.sellingAmount
			},
			buyingAmount: {
				...text,
				example: explorerRecordExamples.trade.buyingAmount
			},
			price
		}),
		description:
			'A parsed trade with exact IDs and price terms. Amount strings retain source Float64 precision.',
		example: explorerRecordExamples.trade
	}
};
for (const [entity, name] of Object.entries(hubbleExplorerEntities)) {
	hubbleExplorerSchemas['HubbleExplorer' + name + 'Page'] = object({
		...metadata(entity),
		rows: array(ref('HubbleExplorer' + name)),
		limit: { type: 'integer', minimum: 1, maximum: 100, example: 10 },
		offset: { type: 'integer', minimum: 0, maximum: 10000, example: 0 },
		nextOffset: {
			type: 'integer',
			nullable: true,
			example: null,
			description:
				'Follow with unchanged filters; null ends results. Offsets above 10000 are rejected: narrow the ledger window to continue. Not a frozen snapshot under backfill.'
		}
	});
	hubbleExplorerSchemas['HubbleExplorer' + name + 'Detail'] = object({
		...metadata(entity),
		record: ref('HubbleExplorer' + name)
	});
	hubbleExplorerSchemas['HubbleExplorer' + name + 'NotFound'] = object({
		...metadata(entity),
		record: { type: 'object', nullable: true, enum: [null] },
		code: text,
		error: text
	});
}
