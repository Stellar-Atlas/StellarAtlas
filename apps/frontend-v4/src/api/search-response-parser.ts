import type {
	PublicSearchDocumentScope,
	PublicSearchFacetName,
	PublicSearchFacets,
	PublicSearchFallbackReason,
	PublicSearchHit,
	PublicSearchRecordState,
	PublicSearchResultSource,
	PublicSearchQueryScope,
	PublicSearchResponse,
	PublicSearchSource
} from './search-types';

const facetNames: readonly PublicSearchFacetName[] = [
	'active',
	'archiveStatus',
	'countryCode',
	'entityType',
	'fullValidator',
	'scope',
	'topTier',
	'validating',
	'validator'
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isIsoTimestamp = (value: unknown): value is string =>
	isString(value) && Number.isFinite(Date.parse(value));
const isNonNegativeInteger = (value: unknown): value is number =>
	typeof value === 'number' && Number.isInteger(value) && value >= 0;

const isSource = (value: unknown): value is PublicSearchSource =>
	value === 'meilisearch' ||
	value === 'postgres_canonical' ||
	value === 'unavailable';

const isResultSource = (value: unknown): value is PublicSearchResultSource =>
	value === 'meilisearch' || value === 'postgres_canonical';

const isScope = (value: unknown): value is PublicSearchQueryScope =>
	value === 'current-validator' ||
	value === 'listener' ||
	value === 'public-key-only' ||
	value === 'archived' ||
	value === 'all-known' ||
	value === 'archive-root' ||
	value === 'current-organization';

const isDocumentScope = (value: unknown): value is PublicSearchDocumentScope =>
	value === 'current-validator' ||
	value === 'listener' ||
	value === 'public-key-only' ||
	value === 'archived' ||
	value === 'archive-root' ||
	value === 'current-organization';

const isRecordState = (value: unknown): value is PublicSearchRecordState =>
	value === 'current' || value === 'historical' || value === 'identity-only';

const isFallbackReason = (
	value: unknown
): value is PublicSearchFallbackReason | null =>
	value === null ||
	value === 'canonical_unavailable' ||
	value === 'meilisearch_stale' ||
	value === 'meilisearch_syncing' ||
	value === 'meilisearch_unavailable' ||
	value === 'meilisearch_unconfigured';

function parseHit(value: unknown): PublicSearchHit | null {
	if (!isRecord(value)) return null;
	if (
		!isString(value.detail) ||
		!isString(value.entityId) ||
		(value.entityType !== 'archive-root' &&
			value.entityType !== 'node' &&
			value.entityType !== 'organization') ||
		(value.freshness !== 'fresh' && value.freshness !== 'stale') ||
		!isString(value.href) ||
		!isString(value.id) ||
		!isString(value.label) ||
		!isIsoTimestamp(value.observedAt) ||
		!isRecordState(value.recordState) ||
		!isDocumentScope(value.scope) ||
		!isResultSource(value.source)
	) {
		return null;
	}
	if (
		(value.evidenceFailures !== undefined &&
			!isNonNegativeInteger(value.evidenceFailures)) ||
		(value.evidenceVerified !== undefined &&
			!isNonNegativeInteger(value.evidenceVerified)) ||
		(value.evidenceProvenance !== undefined &&
			value.evidenceProvenance !== 'postgres_canonical')
	)
		return null;
	if (
		value.organizationName !== undefined &&
		!isString(value.organizationName)
	) {
		return null;
	}

	return {
		detail: value.detail,
		entityId: value.entityId,
		entityType: value.entityType,
		evidenceFailures: value.evidenceFailures,
		evidenceProvenance: value.evidenceProvenance,
		evidenceVerified: value.evidenceVerified,
		freshness: value.freshness,
		href: value.href,
		id: value.id,
		label: value.label,
		observedAt: value.observedAt,
		organizationName: value.organizationName,
		recordState: value.recordState,
		scope: value.scope,
		source: value.source
	};
}

function parseFacetValues(value: unknown) {
	if (!Array.isArray(value)) return null;
	const result: { count: number; value: string }[] = [];
	for (const item of value) {
		if (
			!isRecord(item) ||
			!isNonNegativeInteger(item.count) ||
			!isString(item.value)
		) {
			return null;
		}
		result.push({ count: item.count, value: item.value });
	}
	return result;
}

function parseFacets(value: unknown): PublicSearchFacets | null {
	if (!isRecord(value)) return null;
	const parsed = new Map<
		PublicSearchFacetName,
		ReturnType<typeof parseFacetValues>
	>();
	for (const name of facetNames)
		parsed.set(name, parseFacetValues(value[name]));
	if ([...parsed.values()].some((facet) => facet === null)) return null;
	return {
		active: parsed.get('active') ?? [],
		archiveStatus: parsed.get('archiveStatus') ?? [],
		countryCode: parsed.get('countryCode') ?? [],
		entityType: parsed.get('entityType') ?? [],
		fullValidator: parsed.get('fullValidator') ?? [],
		scope: parsed.get('scope') ?? [],
		topTier: parsed.get('topTier') ?? [],
		validating: parsed.get('validating') ?? [],
		validator: parsed.get('validator') ?? []
	};
}

export function parsePublicSearchResponse(
	value: unknown
): PublicSearchResponse | null {
	if (!isRecord(value)) return null;
	const facets = parseFacets(value.facets);
	const hits = Array.isArray(value.hits) ? value.hits.map(parseHit) : null;
	if (
		facets === null ||
		hits === null ||
		hits.some((hit) => hit === null) ||
		!isNonNegativeInteger(value.estimatedTotalHits) ||
		(value.indexedNetworkTime !== null &&
			!isIsoTimestamp(value.indexedNetworkTime)) ||
		!isString(value.query) ||
		!isScope(value.scope) ||
		!isSource(value.source) ||
		!isRecord(value.pagination) ||
		typeof value.pagination.hasMore !== 'boolean' ||
		!isNonNegativeInteger(value.pagination.limit) ||
		!isNonNegativeInteger(value.pagination.offset) ||
		!isNonNegativeInteger(value.pagination.total) ||
		typeof value.pagination.totalIsExact !== 'boolean' ||
		!isRecord(value.readModel) ||
		(value.readModel.canonicalCursor !== null &&
			!isString(value.readModel.canonicalCursor)) ||
		!isFallbackReason(value.readModel.fallbackReason) ||
		(value.readModel.freshness !== 'fresh' &&
			value.readModel.freshness !== 'stale' &&
			value.readModel.freshness !== 'unavailable') ||
		(value.readModel.observedAt !== null &&
			!isIsoTimestamp(value.readModel.observedAt)) ||
		!isString(value.readModel.schemaVersion) ||
		!isSource(value.readModel.source)
	) {
		return null;
	}

	return {
		estimatedTotalHits: value.estimatedTotalHits,
		facets,
		hits: hits.filter((hit): hit is PublicSearchHit => hit !== null),
		indexedNetworkTime: value.indexedNetworkTime,
		pagination: {
			hasMore: value.pagination.hasMore,
			limit: value.pagination.limit,
			offset: value.pagination.offset,
			total: value.pagination.total,
			totalIsExact: value.pagination.totalIsExact
		},
		query: value.query,
		readModel: {
			canonicalCursor: value.readModel.canonicalCursor,
			fallbackReason: value.readModel.fallbackReason,
			freshness: value.readModel.freshness,
			observedAt: value.readModel.observedAt,
			schemaVersion: value.readModel.schemaVersion,
			source: value.readModel.source
		},
		scope: value.scope,
		source: value.source
	};
}
