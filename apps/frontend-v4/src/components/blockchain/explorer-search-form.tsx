'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { resolveExplorerSearch } from '../../api/explorer-search-route';
import { withExplorerReturnTo } from '../../api/explorer-return-context';

const searchTypes = ['auto', 'transaction', 'account', 'ledger', 'operation', 'asset', 'contract', 'pool'] as const;

export function ExplorerSearchForm(): React.JSX.Element {
	const params = useSearchParams();
	const query = params.get('search')?.slice(0, 128) ?? '';
	const selected = params.get('search_type');
	const type = searchTypes.find((value) => value === selected) ?? 'auto';
	return <SearchForm key={`${type}:${query}`} initialQuery={query} initialType={type} />;
}

function SearchForm({ initialQuery, initialType }: {
	readonly initialQuery: string;
	readonly initialType: string;
}): React.JSX.Element {
	const router = useRouter();
	const [query, setQuery] = useState(initialQuery);
	const [type, setType] = useState(initialType);
	const [error, setError] = useState<string | null>(null);
	return <>
		<form className="explorer-search-form" onSubmit={(event) => {
			event.preventDefault();
			const route = resolveExplorerSearch(query, type);
			if (!route) {
				setError('Enter a valid identifier for the selected search type.');
				return;
			}
			const current = new URL(window.location.href);
			current.searchParams.set('search', query.trim());
			current.searchParams.set('search_type', type);
			const origin = current.pathname + current.search + current.hash;
			// Save the submitted search in this history entry, not on every keystroke.
			window.history.replaceState(window.history.state, '', origin);
			router.push(withExplorerReturnTo(route, origin));
		}}>
			<input aria-label="Explorer search" aria-invalid={error ? true : undefined}
				aria-describedby={error ? 'explorer-search-error' : undefined}
				placeholder="Hash, address, ledger, operation ID, or CODE:ISSUER"
				maxLength={128} value={query} onChange={(event) => { setQuery(event.currentTarget.value); setError(null); }} />
			<select aria-label="Search type" value={type}
				onChange={(event) => { setType(event.currentTarget.value); setError(null); }}>
				{searchTypes.map((value) => <option key={value} value={value}>
					{value === 'auto' ? 'Detect automatically' : value === 'pool' ? 'Liquidity pool' : value}
				</option>)}
			</select>
			<button type="submit" disabled={!query.trim()}>Search</button>
		</form>
		{error && <p id="explorer-search-error" role="alert">{error}</p>}
	</>;
}
