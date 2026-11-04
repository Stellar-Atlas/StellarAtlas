'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { type ExplorerFilters } from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { AssetTable, isoDate, localDate } from './explorer-asset-views';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerInvestigationScope } from './explorer-investigation';
import { assetDiscoveryDraft, assetDiscoveryHref, assetDiscoveryKey, readAssetDiscoverySelection, validateAssetDiscoveryQuery, type AssetDiscoverySelection } from './asset-discovery-page';
import { useAssetDiscoveryPage } from './use-asset-discovery-page';
import { AssetIdentityFilters } from './explorer-asset-identity-filters';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

const observationFacets = [
	['q', 'Search'], ['min_ledger', 'From ledger'], ['max_ledger', 'To ledger'],
	['start_time', 'From time'], ['end_time', 'To time']
] as const;

export function ExplorerAssetDiscovery({ defaultQuery = '' }: { readonly defaultQuery?: string }): React.JSX.Element {
	const pathname = usePathname(), params = useSearchParams(), search = params.toString();
	const fallback = pathname === '/explorer/assets' ? '' : defaultQuery;
	const route = useMemo(() => {
		try { return { selection: readAssetDiscoverySelection(new URLSearchParams(search), fallback), error: null }; }
		catch (failure) { return { selection: null, error: failure instanceof Error ? failure.message : 'Invalid asset search.' }; }
	}, [search, fallback]);
	const selection = route.selection, state = useAssetDiscoveryPage(selection), { page, busy } = state;
	const applied = selection?.query;
	const hasFilters = applied && Object.values(applied).some(Boolean);
	const restored = useMemo(() => assetDiscoveryDraft(new URLSearchParams(search), fallback), [search, fallback]);
	const [draft, setDraft] = useState<ExplorerFilters>(restored), [inputError, setInputError] = useState<string | null>(null);
	useEffect(() => { setDraft(restored); setInputError(null); }, [restored]);
	const previousPages = useRef(new Map<string, AssetDiscoverySelection>());
	const previous = selection ? previousPages.current.get(assetDiscoveryKey(selection)) : undefined;
	const error = route.error || state.error || inputError;
	let recovery: ExplorerFilters | null = null;
	try {
		const first = new URLSearchParams(search); first.delete('cursor'); first.delete('cursor_for');
		recovery = readAssetDiscoverySelection(first, fallback).query;
	} catch { /* Invalid bounds/repeated filters must be corrected, never silently widened. */ }
	const navigate = (next: AssetDiscoverySelection): void => {
		try {
			const requested = { ...next, query: validateAssetDiscoveryQuery(next.query) };
			const href = assetDiscoveryHref(window.location.search, requested, window.location.hash);
			setInputError(null);
			if (href === window.location.pathname + window.location.search + window.location.hash) state.retry();
			else {
				const sameSelection = selection !== null && assetDiscoveryKey(selection) === assetDiscoveryKey(requested);
				state.cancel(); window.history.pushState(null, '', href);
				if (sameSelection) state.retry();
			}
		} catch (failure) { setInputError(failure instanceof Error ? failure.message : 'Invalid asset search.'); }
	};
	const removeFilter = (key: string) => {
		if (applied) navigate({ query: { ...applied, [key]: '' }, cursor: null });
	};
	return <div className={styles.workspace}>
		<ExplorerEntityNavigation active="assets" />
		<section className={styles.panel} aria-label="Asset discovery" aria-busy={busy}>
			<div><h2>Asset discovery</h2><p className={styles.muted}>Search by asset code, issuer or contract address.</p></div>
			<form className={styles.provenance} noValidate onSubmit={event => { event.preventDefault(); navigate({ query: draft, cursor: null }); }}>
				<div className={ui.search}>
					<input aria-label="Search assets" maxLength={2048} placeholder="Asset code, G-address, or C-address" value={draft.q ?? ''} onChange={event => setDraft({ ...draft, q: event.currentTarget.value })} />
					<button disabled={busy} type="submit">Search assets</button>
					{busy && <button type="button" onClick={state.cancel}>Cancel asset search</button>}
				</div>
				<details className={ui.filters}><summary>Filters<span>Exact code, issuer, ledger or time</span></summary>
					<div className={styles.form}>
						<label>Exact asset code<input maxLength={2048} value={draft.symbol ?? ''} onChange={event => setDraft({ ...draft, symbol: event.currentTarget.value })} /></label>
						<label>Issuer address<input maxLength={56} value={draft.issuer ?? ''} onChange={event => setDraft({ ...draft, issuer: event.currentTarget.value })} /></label>
						{(['min_ledger', 'max_ledger'] as const).map((key, index) => <label key={key}>{index === 0 ? 'From ledger' : 'To ledger'}<input type="number" min="1" max="4294967295" value={draft[key] ?? ''} onChange={event => setDraft({ ...draft, [key]: event.currentTarget.value })} /></label>)}
						{(['start_time', 'end_time'] as const).map((key, index) => <label key={key}>{index === 0 ? 'From time' : 'To time'}<input type="datetime-local" value={localDate(draft[key] ?? '')} onChange={event => setDraft({ ...draft, [key]: isoDate(event.currentTarget.value) })} /></label>)}
					</div>
					<div className={styles.actions}><button type="submit" disabled={busy}>Apply filters</button></div>
				</details>
			</form>
			{(hasFilters || route.error) && <div className={styles.provenance} role="group" aria-label="Applied asset filters">
				{applied && <>
					<AssetIdentityFilters query={applied} busy={busy} onRemove={removeFilter} />
					{observationFacets.map(([key, label]) => {
						const value = applied[key];
						if (!value) return null;
						return <div key={key} className={styles.identityFilter}>
							<span>{label}: {key === 'start_time' || key === 'end_time' ? <LocalDateTime dateTime={value} /> : value}</span>
							<button type="button" disabled={busy} onClick={() => removeFilter(key)} aria-label={'Remove ' + label.toLowerCase() + ' filter'}>Remove</button>
						</div>;
					})}
				</>}
				<div className={styles.actions}><button type="button" disabled={busy} onClick={() => navigate({ query: {}, cursor: null })}>Clear all filters</button></div>
			</div>}
			{busy && <p role="status">Loading assets…</p>}
			{error && <p role="alert" className={styles.error}>{error}{selection && <button type="button" disabled={busy} onClick={state.retry}>Retry assets</button>}</p>}
			{page && <>
				{(page.catalogueReady || page.data.length > 0) && <p className={styles.muted}>{page.data.length} {page.data.length === 1 ? 'asset' : 'assets'} on this page{page.generatedAt && <> · catalogue <LocalDateTime dateTime={page.generatedAt} /></>}</p>}
				<p className={styles.muted}>{page.catalogueReady ? 'Published catalogue coverage may be incomplete.' : 'Asset catalogue is not available yet.'}</p>
				{(page.catalogueReady || page.data.length > 0) && <ExplorerInvestigationScope origin={pathname + (search ? '?' + search : '')}><AssetTable assets={page.data} filters={selection?.query} /></ExplorerInvestigationScope>}
			</>}
			<div className={styles.actions}>
				<button type="button" disabled={busy || !previous} onClick={() => previous && navigate(previous)}>Previous assets</button>
				<button type="button" disabled={busy || !page?.next || !selection} onClick={() => {
					if (!selection || !page?.next) return;
					const next = { ...selection, cursor: page.next };
					previousPages.current.set(assetDiscoveryKey(next), selection);
					const oldest = previousPages.current.keys().next().value;
					if (previousPages.current.size > 50 && oldest) previousPages.current.delete(oldest);
					navigate(next);
				}}>Next assets</button>
				<button type="button" disabled={busy || !recovery || (!selection?.cursor && !route.error)} onClick={() => recovery && navigate({ query: recovery, cursor: null })}>First asset page</button>
				<button type="button" disabled={busy || !selection} onClick={state.retry}>Refresh assets</button>
			</div>
		</section>
	</div>;
}
