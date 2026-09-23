import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import {
	hubbleCoverageExample,
	hubbleExampleDescription
} from './HubbleOpenApiExamples.js';

export const text: OpenApiRecord = { type: 'string' };
export const nullableText: OpenApiRecord = { type: 'string', nullable: true };
export const integer: OpenApiRecord = { type: 'integer' };
export const exactInteger: OpenApiRecord = {
	type: 'string',
	pattern: '^-?[0-9]+$',
	example: '123'
};
export const unsignedInteger: OpenApiRecord = {
	type: 'string',
	pattern: '^[0-9]+$',
	example: '123'
};
export const timestamp: OpenApiRecord = { type: 'string', format: 'date-time' };
export function ref(name: string): OpenApiRecord {
	return { $ref: '#/components/schemas/' + name };
}
export function object(
	properties: OpenApiRecord,
	required = Object.keys(properties)
): OpenApiRecord {
	return { type: 'object', additionalProperties: false, properties, required };
}
export function array(items: OpenApiRecord): OpenApiRecord {
	return { type: 'array', items };
}
export function jsonResponse(
	schema: OpenApiRecord,
	description: string,
	example?: OpenApiRecord
): OpenApiRecord {
	return {
		description,
		content: {
			'application/json': {
				schema,
				...(example === undefined ? {} : { example })
			}
		}
	};
}
export function queryParameter(
	name: string,
	description: string,
	schema: OpenApiRecord = text
): OpenApiRecord {
	return { in: 'query', name, description, required: false, schema };
}
const coverageProperties = {
	contiguousFirstLedger: {
		...unsignedInteger,
		nullable: true,
		example: hubbleCoverageExample.contiguousFirstLedger
	},
	contiguousLastLedger: {
		...unsignedInteger,
		nullable: true,
		example: hubbleCoverageExample.contiguousLastLedger
	},
	contiguousLedgerCount: {
		...unsignedInteger,
		example: hubbleCoverageExample.contiguousLedgerCount
	},
	supplementalLedgerCount: {
		...unsignedInteger,
		example: hubbleCoverageExample.supplementalLedgerCount
	},
	totalLedgerCount: {
		...unsignedInteger,
		example: hubbleCoverageExample.totalLedgerCount
	},
	nextLedger: { ...unsignedInteger, example: hubbleCoverageExample.nextLedger },
	minimumLedger: {
		...unsignedInteger,
		nullable: true,
		example: hubbleCoverageExample.minimumLedger
	},
	maximumLedger: {
		...unsignedInteger,
		nullable: true,
		example: hubbleCoverageExample.maximumLedger
	},
	gapCount: { ...integer, minimum: 0, example: hubbleCoverageExample.gapCount }
};
export const hubbleCoverageSchema: OpenApiRecord = {
	...object(
		{
			...coverageProperties,
			completedRanges: {
				...array(
					object({
						firstLedger: { ...unsignedInteger, example: '63490304' },
						lastLedger: { ...unsignedInteger, example: '63490367' }
					})
				),
				description:
					'Disjoint merged completed manifest intervals, including supplemental imports. An interval does not imply the earlier historical gap is ingested.'
			}
		},
		Object.keys(coverageProperties)
	),
	description:
		hubbleExampleDescription +
		' Counts are distinct ingested ledgers, not rows or checkpoints. The sample deliberately contains one gap.',
	example: hubbleCoverageExample
};
export const hubbleErrorSchema = object({ code: text, error: text });
