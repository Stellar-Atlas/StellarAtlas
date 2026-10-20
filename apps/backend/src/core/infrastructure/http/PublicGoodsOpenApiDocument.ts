import {
	readOpenApiRecord,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';

const timestamp = { type: 'string', format: 'date-time' };
const nullableTime = { ...timestamp, nullable: true };
const count = { type: 'integer', minimum: 0, nullable: true };
const exactCount = { type: 'string', pattern: '^\\d+$', nullable: true };
const status = {
	type: 'string',
	enum: ['ready', 'stale', 'empty', 'incomplete', 'unavailable']
};
const object = (properties: OpenApiRecord): OpenApiRecord => ({
	type: 'object',
	additionalProperties: false,
	required: Object.keys(properties),
	properties
});
const check = { status, observedAt: nullableTime };

export const publicGoodsHealthSchema = object({
	generatedAt: timestamp,
	status: { type: 'string', enum: ['ready', 'not_ready'] },
	checks: object({
		clickhouse: object(check),
		publication: object({ ...check, latestCompletedAt: nullableTime }),
		archive: object({
			...check,
			knownRoots: count,
			checkedRoots: count,
			checkedRootWindowHours: { type: 'integer', enum: [24] },
			complete: { type: 'boolean' }
		})
	})
});

export const publicGoodsMetricsSchema = object({
	generatedAt: timestamp,
	publication: object({
		observedAt: nullableTime,
		configuredDatasets: count,
		publishedDatasets: {
			...count,
			description:
				'Publicly queryable datasets with nonzero measured active rows. Does not imply complete historical coverage.'
		},
		completedBatches: exactCount,
		failedBatches: exactCount,
		startedBatches: exactCount,
		records: {
			...exactCount,
			description:
				'Exact sum of projected rows recorded by completed ingestion manifests. Not physical part rows, unique ledgers, or unique transactions.'
		},
		latestCompletedAt: nullableTime,
		maximumLedger: exactCount
	}),
	archives: object({
		observedAt: nullableTime,
		knownRoots: count,
		checkedRoots: {
			...count,
			description:
				'Roots with a recorded source observation within the last 24 hours, including failed observations. Not roots with completely verified history.'
		},
		checkedRootWindowHours: { type: 'integer', enum: [24] },
		rootObjectsVerified: {
			...count,
			description:
				'Roots whose root-state object is verified; not fully verified archive histories.'
		},
		rootObjectsFailed: count,
		oldestEvidenceAt: nullableTime,
		newestEvidenceAt: nullableTime,
		complete: {
			type: 'boolean',
			description:
				'Whether the source inventory used for these counts is complete and untruncated.'
		}
	})
});

function operation(
	operationId: string,
	summary: string,
	schema: OpenApiRecord,
	failure: string
): OpenApiRecord {
	const response = (description: string) => ({
		description,
		headers: {
			'Cache-Control': {
				schema: { type: 'string' },
				description:
					'no-store; responses must not be cached by browsers or CDNs.'
			}
		},
		content: { 'application/json': { schema } }
	});
	return {
		get: {
			operationId,
			summary,
			tags: ['Public goods'],
			security: [],
			description:
				'Read-only. Snapshot measurements are shared in memory for at most 60 seconds; concurrent refreshes are combined. Health additionally probes the warehouse live. Unavailable measurements are null, never invented zeroes. Exact large counters are decimal strings.',
			responses: { '200': response('Available'), '503': response(failure) }
		}
	};
}

export function withPublicGoodsOpenApiPaths(document: unknown): OpenApiRecord {
	const source = readOpenApiRecord(document);
	return {
		...source,
		paths: {
			...readOpenApiRecord(source?.paths),
			'/v1/public-goods/health': operation(
				'getPublicGoodsHealth',
				'Check public-goods readiness',
				publicGoodsHealthSchema,
				'A required check is unavailable, incomplete, empty, or stale. Latest completed publication must be within 24 hours; archive measurements must be fresh and include a recent observation.'
			),
			'/v1/public-goods/metrics': operation(
				'getPublicGoodsMetrics',
				'Read measured public-goods metrics',
				publicGoodsMetricsSchema,
				'At least one measurement source is unavailable. Available source measurements remain present.'
			)
		}
	};
}
