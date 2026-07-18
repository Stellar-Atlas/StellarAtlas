import type { RequiredMeilisearchSettings } from './MeilisearchIndexSettings.js';
import type {
	NetworkSearchDocument,
	NetworkSearchFacetName,
	NetworkSearchFacets,
	NetworkSearchFacetValue,
	NetworkSearchHit,
	NetworkSearchReadModel,
	NetworkSearchRequest,
	NetworkSearchResponse,
	NetworkSearchSnapshot
} from './NetworkSearchTypes.js';

export const networkSearchMaxOffset = 10_000;

export const networkSearchRequiredSettings: RequiredMeilisearchSettings = {
	filterableAttributes: [
		'documentKind',
		'canonicalCursor',
		'entityType',
		'organizationId',
		'organizationName',
		'scope',
		'validating',
		'validator',
		'fullValidator',
		'topTier',
		'active',
		'archiveStatus',
		'countryCode',
		'countryName',
		'isp',
		'latestLedger',
		'networkTime'
	],
	searchableAttributes: [
		'label',
		'detail',
		'content',
		'publicKey',
		'homeDomain',
		'organizationName',
		'version',
		'countryName',
		'countryCode',
		'isp'
	],
	sortableAttributes: ['label', 'id', 'networkTime', 'latestLedger']
};

export const networkSearchFacetAttributes: readonly NetworkSearchFacetName[] = [
	'entityType',
	'scope',
	'archiveStatus',
	'countryCode',
	'validator',
	'validating',
	'fullValidator',
	'active',
	'topTier'
];

export const networkSearchHitAttributes = [
	'detail',
	'entityId',
	'entityType',
	'evidenceFailures',
	'evidenceProvenance',
	'evidenceVerified',
	'href',
	'id',
	'label',
	'observedAt',
	'organizationName',
	'recordState',
	'scope'
] as const;

export const sanitizeSearchLimit = (limit: number): number => {
	if (!Number.isInteger(limit)) return 8;
	return Math.min(Math.max(limit, 1), 25);
};

export const sanitizeSearchOffset = (offset: number): number => {
	if (!Number.isInteger(offset)) return 0;
	return Math.min(Math.max(offset, 0), networkSearchMaxOffset);
};

export const toSearchHit = (
	document: NetworkSearchDocument,
	source: NetworkSearchHit['source'],
	freshness: NetworkSearchHit['freshness'] = 'fresh'
): NetworkSearchHit => ({
	detail: document.detail,
	entityId: document.entityId,
	entityType: document.entityType,
	evidenceFailures: document.evidenceFailures,
	evidenceProvenance: document.evidenceProvenance,
	evidenceVerified: document.evidenceVerified,
	freshness,
	href: document.href,
	id: document.id,
	label: document.label,
	observedAt: document.observedAt,
	organizationName: document.organizationName,
	recordState: document.recordState,
	scope: document.scope,
	source
});

const normalize = (value: string): string => value.trim().toLowerCase();

const matchesDocument = (
	document: NetworkSearchDocument,
	request: NetworkSearchRequest
): boolean => {
	if (request.scope !== 'all-known' && document.scope !== request.scope) {
		return false;
	}
	if (request.entityType && document.entityType !== request.entityType) {
		return false;
	}
	if (
		request.archiveStatus &&
		document.archiveStatus !== request.archiveStatus
	) {
		return false;
	}
	if (request.countryCode && document.countryCode !== request.countryCode) {
		return false;
	}
	if (
		request.organizationId &&
		document.organizationId !== request.organizationId
	) {
		return false;
	}
	if (request.active !== undefined && document.active !== request.active) {
		return false;
	}
	if (
		request.fullValidator !== undefined &&
		document.fullValidator !== request.fullValidator
	) {
		return false;
	}
	if (
		request.validator !== undefined &&
		document.validator !== request.validator
	) {
		return false;
	}
	if (
		request.validating !== undefined &&
		document.validating !== request.validating
	) {
		return false;
	}
	if (request.topTier !== undefined && document.topTier !== request.topTier) {
		return false;
	}

	const query = normalize(request.query);
	return query.length === 0 || normalize(document.content).includes(query);
};

const emptyFacets = (): NetworkSearchFacets => ({
	active: [],
	archiveStatus: [],
	countryCode: [],
	entityType: [],
	fullValidator: [],
	scope: [],
	topTier: [],
	validating: [],
	validator: []
});

const sortFacetValues = (
	values: NetworkSearchFacetValue[]
): NetworkSearchFacetValue[] =>
	values.toSorted(
		(left, right) =>
			right.count - left.count || left.value.localeCompare(right.value)
	);

export const buildFacetsFromDocuments = (
	documents: readonly NetworkSearchDocument[]
): NetworkSearchFacets => {
	const facets = emptyFacets();
	for (const facet of networkSearchFacetAttributes) {
		const counts = new Map<string, number>();
		for (const document of documents) {
			const value = document[facet];
			if (value === undefined) continue;
			const textValue = String(value);
			counts.set(textValue, (counts.get(textValue) ?? 0) + 1);
		}
		facets[facet] = sortFacetValues(
			Array.from(counts, ([value, count]) => ({ count, value }))
		);
	}
	return facets;
};

export const buildFacetsFromDistribution = (
	distribution: Record<string, Record<string, number>> | undefined
): NetworkSearchFacets => {
	const facets = emptyFacets();
	for (const facet of networkSearchFacetAttributes) {
		const values = distribution?.[facet];
		if (!values) continue;
		facets[facet] = sortFacetValues(
			Object.entries(values).map(([value, count]) => ({ count, value }))
		);
	}
	return facets;
};

export const memorySearch = (
	snapshot: NetworkSearchSnapshot,
	request: NetworkSearchRequest,
	readModel: NetworkSearchReadModel
): NetworkSearchResponse => {
	const matching = snapshot.documents
		.filter((document) => matchesDocument(document, request))
		.toSorted(compareSearchDocuments);
	const limit = sanitizeSearchLimit(request.limit);
	const offset = sanitizeSearchOffset(request.offset);
	const hits = matching
		.slice(offset, offset + limit)
		.map((document) => toSearchHit(document, 'postgres_canonical'));

	return {
		estimatedTotalHits: matching.length,
		facets: buildFacetsFromDocuments(matching),
		hits,
		indexedNetworkTime: snapshot.networkTime,
		pagination: {
			hasMore: offset + hits.length < matching.length,
			limit,
			offset,
			total: matching.length,
			totalIsExact: true
		},
		query: request.query,
		readModel,
		scope: request.scope,
		source: 'postgres_canonical'
	};
};

const compareText = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0;

const compareSearchDocuments = (
	left: NetworkSearchDocument,
	right: NetworkSearchDocument
): number =>
	compareText(normalize(left.label), normalize(right.label)) ||
	compareText(left.id, right.id);

export interface NetworkSearchTotal {
	readonly exact: boolean;
	readonly value: number;
}

export const deriveSearchTotal = (
	distribution: Record<string, Record<string, number>> | undefined,
	estimatedTotalHits: number | undefined,
	hitCount: number,
	offset = 0
): NetworkSearchTotal => {
	const minimumTotal = offset + hitCount;
	if (
		distribution !== undefined &&
		Object.prototype.hasOwnProperty.call(distribution, 'entityType')
	) {
		const counts = Object.values(distribution.entityType ?? {});
		if (counts.every((count) => Number.isSafeInteger(count) && count >= 0)) {
			const exactTotal = counts.reduce((total, count) => total + count, 0);
			if (exactTotal < minimumTotal) {
				return {
					exact: false,
					value: Math.max(estimatedTotalHits ?? 0, minimumTotal)
				};
			}
			return {
				exact: true,
				value: exactTotal
			};
		}
	}
	return {
		exact: false,
		value:
			estimatedTotalHits !== undefined &&
			Number.isSafeInteger(estimatedTotalHits) &&
			estimatedTotalHits >= 0
				? Math.max(estimatedTotalHits, minimumTotal)
				: minimumTotal
	};
};

const quoteFilterValue = (value: string): string => JSON.stringify(value);

const filterCondition = (
	field: string,
	value: string | boolean | undefined
): string | undefined => {
	if (value === undefined) return undefined;
	return typeof value === 'boolean'
		? `${field} = ${value}`
		: `${field} = ${quoteFilterValue(value)}`;
};

export const buildMeilisearchFilter = (
	request: NetworkSearchRequest,
	canonicalCursor: string
): string =>
	[
		filterCondition('documentKind', 'entity'),
		filterCondition('canonicalCursor', canonicalCursor),
		filterCondition(
			'scope',
			request.scope === 'all-known' ? undefined : request.scope
		),
		filterCondition('entityType', request.entityType),
		filterCondition('archiveStatus', request.archiveStatus),
		filterCondition('countryCode', request.countryCode),
		filterCondition('organizationId', request.organizationId),
		filterCondition('active', request.active),
		filterCondition('fullValidator', request.fullValidator),
		filterCondition('validator', request.validator),
		filterCondition('validating', request.validating),
		filterCondition('topTier', request.topTier)
	]
		.filter((filter): filter is string => filter !== undefined)
		.join(' AND ');
