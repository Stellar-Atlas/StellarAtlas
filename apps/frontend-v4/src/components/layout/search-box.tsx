'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicKnownNodeScope } from '../../api/known-network-types';
import type {
	PublicSearchFacetName,
	PublicSearchHit,
	PublicSearchResponse
} from '../../api/search-types';
import {
	searchNetwork,
	type SearchNetworkFilters
} from '../../app/actions/search';

interface SearchOption {
	id: string;
	label: string;
	detail: string;
	href: string;
	kind: PublicSearchHit['entityType'];
	scope: PublicSearchHit['scope'];
}

interface SearchFacetOption {
	active: boolean;
	count: number;
	label: string;
	name: PublicSearchFacetName;
	value: string;
}

const booleanFacetLabels: Partial<Record<PublicSearchFacetName, string>> = {
	active: 'Active',
	fullValidator: 'Full validators',
	topTier: 'Top tier',
	validating: 'Validating',
	validator: 'Validators'
};

const scopeLabels: Record<PublicKnownNodeScope, string> = {
	'all-known': 'All known',
	archived: 'Archived / inactive',
	'current-validator': 'Current validators',
	listener: 'Current listeners',
	'public-key-only': 'Public-key only'
};

const normalize = (value: string): string => value.trim().toLowerCase();

const searchHitToOption = (hit: PublicSearchHit): SearchOption => ({
	detail: hit.detail,
	href: hit.href,
	id: hit.id,
	kind: hit.entityType,
	label: hit.label,
	scope: hit.scope
});

const getFilterValue = (
	filters: SearchNetworkFilters,
	name: PublicSearchFacetName
): string | undefined => {
	if (name === 'entityType') return filters.entityType;
	if (name === 'archiveStatus') return filters.archiveStatus;
	if (name === 'countryCode') return filters.countryCode;
	if (name === 'scope') return filters.scope;
	if (name === 'active') return booleanText(filters.active);
	if (name === 'fullValidator') return booleanText(filters.fullValidator);
	if (name === 'topTier') return booleanText(filters.topTier);
	if (name === 'validating') return booleanText(filters.validating);
	return booleanText(filters.validator);
};

const booleanText = (value: boolean | undefined): string | undefined =>
	value === undefined ? undefined : value ? 'true' : 'false';

const getFacetLabel = (name: PublicSearchFacetName, value: string): string => {
	if (name === 'entityType')
		return value === 'node'
			? 'Nodes'
			: value === 'archive-root'
				? 'Archive roots'
				: 'Organizations';
	if (name === 'archiveStatus') return `Archive ${value}`;
	if (name === 'countryCode') return value.toUpperCase();
	if (name === 'scope' && isKnownNodeScope(value)) return scopeLabels[value];
	return booleanFacetLabels[name] ?? value;
};

const isKnownNodeScope = (value: string): value is PublicKnownNodeScope =>
	value === 'all-known' ||
	value === 'archived' ||
	value === 'current-validator' ||
	value === 'listener' ||
	value === 'public-key-only';

const isEntityType = (
	value: string
): value is NonNullable<SearchNetworkFilters['entityType']> =>
	value === 'archive-root' || value === 'node' || value === 'organization';

const isArchiveStatus = (
	value: string
): value is NonNullable<SearchNetworkFilters['archiveStatus']> =>
	value === 'error' || value === 'ok' || value === 'unknown';

const selectFacetOptions = (
	response: PublicSearchResponse | null,
	filters: SearchNetworkFilters
): SearchFacetOption[] => {
	if (!response) return [];
	const facetNames: PublicSearchFacetName[] = [
		'entityType',
		'scope',
		'validator',
		'validating',
		'fullValidator',
		'topTier',
		'archiveStatus',
		'countryCode'
	];
	return facetNames.flatMap((name) =>
		response.facets[name]
			.filter((facet) =>
				name in booleanFacetLabels
					? facet.value === 'true'
					: name === 'scope'
						? isKnownNodeScope(facet.value)
						: facet.count > 0
			)
			.slice(0, name === 'countryCode' ? 3 : 4)
			.map((facet) => ({
				active: getFilterValue(filters, name) === facet.value,
				count: facet.count,
				label: getFacetLabel(name, facet.value),
				name,
				value: facet.value
			}))
	);
};

const toggleFacetFilter = (
	filters: SearchNetworkFilters,
	facet: SearchFacetOption
): SearchNetworkFilters => {
	const next = { ...filters };
	const active = getFilterValue(filters, facet.name) === facet.value;
	if (active) {
		if (facet.name === 'entityType') delete next.entityType;
		else if (facet.name === 'archiveStatus') delete next.archiveStatus;
		else if (facet.name === 'countryCode') delete next.countryCode;
		else if (facet.name === 'scope') next.scope = 'all-known';
		else if (facet.name === 'active') delete next.active;
		else if (facet.name === 'fullValidator') delete next.fullValidator;
		else if (facet.name === 'topTier') delete next.topTier;
		else if (facet.name === 'validating') delete next.validating;
		else if (facet.name === 'validator') delete next.validator;
		return next;
	}
	if (facet.name === 'entityType' && isEntityType(facet.value))
		next.entityType = facet.value;
	else if (facet.name === 'archiveStatus' && isArchiveStatus(facet.value))
		next.archiveStatus = facet.value;
	else if (facet.name === 'countryCode') next.countryCode = facet.value;
	else if (facet.name === 'scope' && isKnownNodeScope(facet.value))
		next.scope = facet.value;
	else if (facet.name === 'active') next.active = facet.value === 'true';
	else if (facet.name === 'fullValidator')
		next.fullValidator = facet.value === 'true';
	else if (facet.name === 'topTier') next.topTier = facet.value === 'true';
	else if (facet.name === 'validating')
		next.validating = facet.value === 'true';
	else if (facet.name === 'validator') next.validator = facet.value === 'true';
	return next;
};

export function SearchBox(): React.JSX.Element {
	const router = useRouter();
	const [query, setQuery] = useState('');
	const [filters, setFilters] = useState<SearchNetworkFilters>({
		scope: 'all-known'
	});
	const [response, setResponse] = useState<PublicSearchResponse | null>(null);
	const canSearch = useMemo(() => {
		const normalizedQuery = normalize(query);
		return normalizedQuery.length >= 2;
	}, [query]);
	const matches = useMemo(
		() => response?.hits.map(searchHitToOption) ?? [],
		[response]
	);
	const facets = useMemo(
		() => selectFacetOptions(response, filters).slice(0, 10),
		[filters, response]
	);

	useEffect(() => {
		if (!canSearch) {
			setResponse(null);
			return;
		}

		let cancelled = false;
		const timeout = setTimeout(() => {
			void searchNetwork(query, filters)
				.then((response) => {
					if (!cancelled) setResponse(response);
				})
				.catch(() => {
					if (!cancelled) setResponse(null);
				});
		}, 120);

		return () => {
			cancelled = true;
			clearTimeout(timeout);
		};
	}, [canSearch, filters, query]);

	const submitSearch = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		const firstMatch = matches.at(0);
		if (firstMatch) router.push(firstMatch.href);
	};

	return (
		<form className="search" onSubmit={submitSearch}>
			<input
				aria-label="Search nodes and organizations"
				onChange={(event) => setQuery(event.currentTarget.value)}
				placeholder="Search nodes or organizations"
				value={query}
			/>
			{canSearch && response && (
				<div
					className="search-menu"
					data-freshness={response.readModel.freshness}
					data-source={response.source}
				>
					<div className="search-menu-meta">
						<span>
							{response.pagination.total.toLocaleString()}{' '}
							{response.pagination.totalIsExact
								? 'matches'
								: 'estimated matches'}
						</span>
						<small>{scopeLabels[response.scope]}</small>
					</div>
					{facets.length > 0 && (
						<div className="search-facets">
							{facets.map((facet) => (
								<button
									className={`search-facet${facet.active ? ' active' : ''}`}
									key={`${facet.name}-${facet.value}`}
									onClick={() =>
										setFilters((currentFilters) =>
											toggleFacetFilter(currentFilters, facet)
										)
									}
									type="button"
								>
									<span>{facet.label}</span>
									<small>{facet.count}</small>
								</button>
							))}
						</div>
					)}
					{matches.map((match) => (
						<button
							className="search-result"
							key={`${match.kind}-${match.id}`}
							onClick={() => router.push(match.href)}
							type="button"
						>
							<strong>{match.label}</strong>
							<span>{match.detail}</span>
							<small>{getSearchResultScopeLabel(match)}</small>
						</button>
					))}
					{matches.length === 0 && (
						<div className="search-empty">No results</div>
					)}
				</div>
			)}
		</form>
	);
}

function getSearchResultScopeLabel(hit: SearchOption): string {
	if (hit.scope === 'current-organization') return 'Current organization';
	if (hit.scope === 'archive-root') return 'Archive root';
	return scopeLabels[hit.scope];
}
