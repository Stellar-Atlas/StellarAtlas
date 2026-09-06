import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { array, exactInteger, integer, nullableText, object, ref, text, timestamp } from './HubbleOpenApiSchemas.js';

const asset = object({ id: text, type: text, code: nullableText, issuer: nullableText });
const sourceRecord = object({ batchId: text, digest: text, rowNumber: exactInteger });
const shared = { ledgerSequence: integer, closedAt: timestamp, sourceRecord };
const pair = { sellingAsset: ref('HubbleExplorerAsset'), buyingAsset: ref('HubbleExplorerAsset'), amountPrecision: { type: 'string', enum: ['source_float64'], description: 'Source ETL amount was Float64. String serialization does not recover lost precision; not exact atomic units.' } };
const price = object({ numerator: exactInteger, denominator: exactInteger });
const metadata = (entity: string): OpenApiRecord => ({
	entity: { type: 'string', enum: [entity] },
	window: object({ minLedger: integer, maxLedger: integer }),
	coverage: ref('HubbleLedgerCoverage'),
	coverageStatus: { type: 'string', enum: ['complete', 'partial_or_unknown'], description: 'Complete only when the window is inside the contiguous parsed prefix. Supplemental windows remain conservatively partial_or_unknown.' },
	source: { type: 'string', enum: ['stellar_hubble'] },
	semantics: text
});
export const hubbleExplorerEntities = {
	operations: 'Operation', assets: 'Asset', contracts: 'Contract', offers: 'Offer', trades: 'Trade'
} as const;
export const hubbleExplorerSchemas: Record<string, OpenApiRecord> = {
	HubbleExplorerAsset: asset,
	HubbleExplorerContract: object({ id: text }),
	HubbleExplorerOperation: object({
		...shared, id: exactInteger, transactionId: exactInteger, transactionHash: { ...nullableText, pattern: '^[0-9a-f]{64}$', description: 'Resolved from a matching completed parsed transaction row; null if unavailable.' },
		sourceAccount: text, type: text, typeCode: integer,
		details: { description: 'Supplemental parsed ETL details, which may contain rounded legacy amounts; not the exact envelope-derived transaction amounts.' }
	}),
	HubbleExplorerOffer: object({
		...shared, ...pair, id: exactInteger, seller: text, amount: text, price,
		deleted: { type: 'boolean' }, lastModifiedLedger: integer
	}),
	HubbleExplorerTrade: object({
		...shared, ...pair, id: { type: 'string', pattern: '^[0-9]+:[0-9]+$' },
		operationId: exactInteger, order: integer, seller: nullableText, buyer: nullableText,
		sellingAmount: text, buyingAmount: text, price
	})
};
for (const [entity, name] of Object.entries(hubbleExplorerEntities)) {
	hubbleExplorerSchemas['HubbleExplorer' + name + 'Page'] = object({
		...metadata(entity), rows: array(ref('HubbleExplorer' + name)),
		limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 10000 },
		nextOffset: { type: 'integer', nullable: true, description: 'Follow with unchanged filters; null ends results. Offsets above 10000 are rejected: narrow the ledger window to continue. Not a frozen snapshot under backfill.' }
	});
	hubbleExplorerSchemas['HubbleExplorer' + name + 'Detail'] = object({
		...metadata(entity), record: ref('HubbleExplorer' + name)
	});
	hubbleExplorerSchemas['HubbleExplorer' + name + 'NotFound'] = object({
		...metadata(entity), record: { type: 'object', nullable: true, enum: [null] }, code: text, error: text
	});
}
