'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { explorerSearchNavigation } from '../../api/explorer-search-route';

const searchTypes = ['auto', 'transaction', 'account', 'ledger', 'operation', 'asset', 'contract', 'pool', 'soroban-domain'] as const;

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
			const navigation = explorerSearchNavigation(window.location.href, query, type);
			if (!navigation) {
				setError(type === 'soroban-domain'
					? 'Enter an exact .xlm name with one to four alphabetic labels of at most 15 letters each.'
					: 'Enter a valid identifier for the selected search type.');
				return;
			}
			// Save the submitted search in this history entry, not on every keystroke.
			window.history.replaceState(null, '', navigation.origin);
			router.push(navigation.destination);
		}}>
			<input aria-label="Explorer search" aria-invalid={error ? true : undefined}
				aria-describedby={error ? 'explorer-search-error' : undefined}
				placeholder={type === 'soroban-domain' ? 'example.xlm' : 'Hash, address, ledger, operation ID, or asset code'}
				maxLength={128} value={query} onChange={(event) => { setQuery(event.currentTarget.value); setError(null); }} />
			<select aria-label="Search type" value={type}
				onChange={(event) => { setType(event.currentTarget.value); setError(null); }}>
				{searchTypes.map((value) => <option key={value} value={value}>
					{value === 'auto' ? 'Detect automatically' : value === 'pool' ? 'Liquidity pool'
						: value === 'soroban-domain' ? 'Soroban Domains (.xlm)' : value}
				</option>)}
			</select>
			<button type="submit" disabled={!query.trim()}>Search</button>
		</form>
		{error && <p id="explorer-search-error" role="alert">{error}</p>}
	</>;
}
