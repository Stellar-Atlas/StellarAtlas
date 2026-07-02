'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { PublicNetwork } from '../../api/types';
import { fetchBrowserPublicNetwork } from '../../api/browser-client';
import { getNodeLabel, getOrganizationLabel } from '../../domain/network';

interface SearchOption {
	id: string;
	label: string;
	detail: string;
	href: string;
	kind: 'node' | 'organization';
}

const normalize = (value: string): string => value.trim().toLowerCase();

const buildSearchOptions = (network: PublicNetwork): SearchOption[] => [
	...network.nodes.map((node) => ({
		id: node.publicKey,
		label: getNodeLabel(node),
		detail: node.homeDomain ?? node.publicKey,
		href: `/nodes/${encodeURIComponent(node.publicKey)}`,
		kind: 'node' as const
	})),
	...network.organizations.map((organization) => ({
		id: organization.id,
		label: getOrganizationLabel(organization),
		detail: organization.homeDomain,
		href: `/organizations/${encodeURIComponent(organization.id)}`,
		kind: 'organization' as const
	}))
];

export function SearchBox(): React.JSX.Element {
	const router = useRouter();
	const [query, setQuery] = useState('');
	const [network, setNetwork] = useState<PublicNetwork | null>(null);
	const options = useMemo(
		() => (network ? buildSearchOptions(network) : []),
		[network]
	);
	const matches = useMemo(() => {
		const normalizedQuery = normalize(query);
		if (normalizedQuery.length < 2) return [];

		return options
			.filter((option) =>
				normalize(`${option.label} ${option.detail} ${option.id}`).includes(
					normalizedQuery
				)
			)
			.slice(0, 8);
	}, [options, query]);

	useEffect(() => {
		const abortController = new AbortController();
		void fetchBrowserPublicNetwork(abortController.signal)
			.then(setNetwork)
			.catch(() => undefined);

		return () => abortController.abort();
	}, []);

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
				placeholder={
					network ? 'Search nodes or organizations' : 'Loading search'
				}
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
