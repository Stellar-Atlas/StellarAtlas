import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

export const text: OpenApiRecord = { type: 'string' };
export const nullableText: OpenApiRecord = { type: 'string', nullable: true };
export const integer: OpenApiRecord = { type: 'integer' };
export const exactInteger: OpenApiRecord = { type: 'string', pattern: '^-?[0-9]+$' };
export const timestamp: OpenApiRecord = { type: 'string', format: 'date-time' };
export function ref(name: string): OpenApiRecord {
	return { $ref: '#/components/schemas/' + name };
}
export function object(properties: OpenApiRecord, required = Object.keys(properties)): OpenApiRecord {
	return { type: 'object', additionalProperties: false, properties, required };
}
export function array(items: OpenApiRecord): OpenApiRecord { return { type: 'array', items }; }
export function jsonResponse(schema: OpenApiRecord, description: string, example?: OpenApiRecord): OpenApiRecord {
	return {
		description,
		content: { 'application/json': { schema, ...(example === undefined ? {} : { example }) } }
	};
}
export function queryParameter(name: string, description: string, schema: OpenApiRecord = text): OpenApiRecord {
	return { in: 'query', name, description, required: false, schema };
}
export const hubbleCoverageSchema = object({
	contiguousFirstLedger: nullableText, contiguousLastLedger: nullableText,
	contiguousLedgerCount: exactInteger, supplementalLedgerCount: exactInteger,
	totalLedgerCount: exactInteger, nextLedger: exactInteger,
	minimumLedger: nullableText, maximumLedger: nullableText, gapCount: integer
});
export const hubbleErrorSchema = object({ code: text, error: text });
