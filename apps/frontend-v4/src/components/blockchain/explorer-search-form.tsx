'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { explorerSearchNavigation } from '../../api/explorer-search-route';
import { ISSUER_DOMAIN_MAX_INPUT } from '../../api/issuer-domain';
import { MAX_SOROBAN_DOMAIN_NAME_LENGTH } from '../../domain/soroban-domain-name';
import { recordAtlasView } from '../atlas-analytics';

const searchTypes = ['auto', 'transaction', 'account', 'ledger', 'operation', 'asset', 'contract', 'pool', 'issuer-domain', 'soroban-domain'] as const;
const inputLimit = (type: string): number => type === 'issuer-domain' ? ISSUER_DOMAIN_MAX_INPUT :
	type === 'soroban-domain' ? MAX_SOROBAN_DOMAIN_NAME_LENGTH : 128;

export function ExplorerSearchForm(): React.JSX.Element {
	const params = useSearchParams();
	const selected = params.get('search_type');
	const type = searchTypes.find((value) => value === selected) ?? 'auto';
	const query = params.get('search')?.slice(0, inputLimit(type)) ?? '';
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
					: type === 'issuer-domain' ? 'Enter a DNS hostname, such as example.org.'
					: 'Enter a valid identifier for the selected search type.');
				return;
			}
			// Save the submitted search in this history entry, not on every keystroke.
			recordAtlasView('explorerSearch');
			window.history.replaceState(null, '', navigation.origin);
			router.push(navigation.destination);
		}}>
			<input aria-label="Explorer search" aria-invalid={error ? true : undefined}
				aria-describedby={error ? 'explorer-search-error' : undefined}
				placeholder={type === 'issuer-domain' ? 'example.org' :
					type === 'soroban-domain' ? 'example.xlm' : 'Hash, address, ledger, operation ID, or asset code'}
				maxLength={inputLimit(type)} value={query} onChange={(event) => { setQuery(event.currentTarget.value); setError(null); }} />
			<select aria-label="Search type" value={type}
				onChange={(event) => { setType(event.currentTarget.value); setError(null); }}>
				{searchTypes.map((value) => <option key={value} value={value}>
					{value === 'auto' ? 'Detect automatically' : value === 'pool' ? 'Liquidity pool' :
						value === 'issuer-domain' ? 'Issuer domain' :
						value === 'soroban-domain' ? 'Soroban Domains (.xlm)' : value}
				</option>)}
			</select>
			<button type="submit" disabled={!query.trim()}>Search</button>
		</form>
		{error && <p id="explorer-search-error" role="alert">{error}</p>}
	</>;
}
