'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicSearchHit } from '../../api/types';
import { fetchBrowserSearch } from '../../api/browser-client';

interface SearchOption {
	id: string;
	label: string;
	detail: string;
	href: string;
	kind: PublicSearchHit['entityType'];
}

const normalize = (value: string): string => value.trim().toLowerCase();

const searchHitToOption = (hit: PublicSearchHit): SearchOption => ({
	detail: hit.detail,
	href: hit.href,
	id: hit.id,
	kind: hit.entityType,
	label: hit.label
});

export function SearchBox(): React.JSX.Element {
	const router = useRouter();
	const [query, setQuery] = useState('');
	const [matches, setMatches] = useState<SearchOption[]>([]);
	const canSearch = useMemo(() => {
		const normalizedQuery = normalize(query);
		return normalizedQuery.length >= 2;
	}, [query]);

	useEffect(() => {
		if (!canSearch) {
			setMatches([]);
			return;
		}

		const abortController = new AbortController();
		const timeout = setTimeout(() => {
			void fetchBrowserSearch(query, abortController.signal)
				.then((response) => setMatches(response.hits.map(searchHitToOption)))
				.catch(() => setMatches([]));
		}, 120);

		return () => {
			clearTimeout(timeout);
			abortController.abort();
		};
	}, [canSearch, query]);

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
			{matches.length > 0 && (
				<div className="search-menu">
					{matches.map((match) => (
						<button
							key={`${match.kind}-${match.id}`}
							onClick={() => router.push(match.href)}
							type="button"
						>
							<strong>{match.label}</strong>
							<span>{match.detail}</span>
						</button>
					))}
				</div>
			)}
		</form>
	);
}
