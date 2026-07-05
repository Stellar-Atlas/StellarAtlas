'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
	PublicSearchFacetName,
	PublicSearchHit,
	PublicSearchResponse
} from '../../api/types';
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

const fallbackLabels: Record<
	NonNullable<PublicSearchResponse['readModel']['fallbackReason']>,
	string
> = {
	meilisearch_syncing: 'Meilisearch syncing',
	meilisearch_unavailable: 'Meilisearch unavailable',
	meilisearch_unconfigured: 'Meilisearch unconfigured'
};

const normalize = (value: string): string => value.trim().toLowerCase();

const searchHitToOption = (hit: PublicSearchHit): SearchOption => ({
	detail: hit.detail,
	href: hit.href,
	id: hit.id,
	kind: hit.entityType,
	label: hit.label
});

const getFilterValue = (
	filters: SearchNetworkFilters,
	name: PublicSearchFacetName
): string | undefined => {
	if (name === 'entityType') return filters.entityType;
	const value = filters[name as keyof SearchNetworkFilters];
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	return value;
};

const getFacetLabel = (name: PublicSearchFacetName, value: string): string => {
	if (name === 'entityType')
		return value === 'node' ? 'Nodes' : 'Organizations';
	if (name === 'archiveStatus') return `Archive ${value}`;
	if (name === 'countryCode') return value.toUpperCase();
	return booleanFacetLabels[name] ?? value;
};

const selectFacetOptions = (
	response: PublicSearchResponse | null,
	filters: SearchNetworkFilters
): SearchFacetOption[] => {
	if (!response) return [];
	const facetNames: PublicSearchFacetName[] = [
		'entityType',
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
				name in booleanFacetLabels ? facet.value === 'true' : facet.count > 0
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
		else if (facet.name === 'active') delete next.active;
		else if (facet.name === 'fullValidator') delete next.fullValidator;
		else if (facet.name === 'topTier') delete next.topTier;
		else if (facet.name === 'validating') delete next.validating;
		else if (facet.name === 'validator') delete next.validator;
		return next;
	}
	if (facet.name === 'entityType')
		next.entityType = facet.value as 'node' | 'organization';
	else if (facet.name === 'archiveStatus')
		next.archiveStatus = facet.value as 'error' | 'ok' | 'unknown';
	else if (facet.name === 'countryCode') next.countryCode = facet.value;
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
	const [filters, setFilters] = useState<SearchNetworkFilters>({});
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
	const fallbackReason = response?.readModel.fallbackReason ?? null;

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
				<div className="search-menu">
					<div className="search-menu-meta">
						<span>
							{response.source === 'meilisearch' ? 'Meilisearch' : 'Memory'}{' '}
							search
						</span>
						{fallbackReason && <span>{fallbackLabels[fallbackReason]}</span>}
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
