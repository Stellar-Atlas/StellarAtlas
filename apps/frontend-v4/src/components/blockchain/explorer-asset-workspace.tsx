'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import {
	AssetTable,
	AssetDetails,
	IssuerDetails,
	isoDate,
	localDate
} from './explorer-asset-views';
import type {
	Asset,
	AssetPage,
	AssetRecord,
	Metadata
} from './explorer-asset-types';
import { useEffect, useRef, useState } from 'react';
import {
	entityText,
	recordValue,
	requestExplorerJson,
	type ExplorerFilters
} from '../../api/explorer-analytics';
import { ExplorerAssetTabs } from './explorer-asset-tabs';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';

const EMPTY_FILTERS: ExplorerFilters = Object.freeze({});
const POLL_DELAYS = [2_000, 4_000, 8_000, 15_000] as const;

type Props = {
	assetRef?: string;
	issuerId?: string;
	initialFilters?: ExplorerFilters;
};

function object(value: unknown) {
	return recordValue(value);
}
function stringFields(value: unknown): Readonly<Record<string, string>> {
	const row = object(value);
	return Object.fromEntries(
		Object.entries(row).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		)
	);
}
function parseAsset(value: unknown): Asset {
	const data = object(value);
	const kind = entityText(data, 'kind');
	const id = entityText(data, 'id');
	if (!id || !['native', 'classic', 'contract'].includes(kind))
		throw new Error('Invalid asset returned by the data service.');
	const number = (input: unknown) =>
		typeof input === 'number' && Number.isSafeInteger(input)
			? input
			: undefined;
	return {
		id,
		kind: kind as Asset['kind'],
		code: entityText(data, 'code') || undefined,
		issuer: entityText(data, 'issuer') || undefined,
		contractId: entityText(data, 'contractId') || undefined,
		observed: typeof data.observed === 'boolean' ? data.observed : undefined,
		name: entityText(data, 'name') || undefined,
		logoUrl: entityText(data, 'logoUrl') || undefined,
		firstObservedLedger: number(data.firstObservedLedger),
		lastObservedLedger: number(data.lastObservedLedger),
		firstObservedAt: entityText(data, 'firstObservedAt') || undefined,
		lastObservedAt: entityText(data, 'lastObservedAt') || undefined
	};
}
function parseMetadata(value: unknown): Metadata {
	const row = object(value);
	const rawOrganization = row.organization;
	const organization =
		typeof rawOrganization === 'string'
			? rawOrganization
			: Object.keys(stringFields(rawOrganization)).length
				? stringFields(rawOrganization)
				: undefined;
	return {
		status: entityText(row, 'status') || undefined,
		name: entityText(row, 'name') || undefined,
		description: entityText(row, 'description') || undefined,
		homeDomain: entityText(row, 'homeDomain') || undefined,
		tomlUrl: entityText(row, 'tomlUrl') || undefined,
		logoUrl: entityText(row, 'logoUrl') || undefined,
		organization,
		fields: stringFields(row.fields),
		fetchedAt: entityText(row, 'fetchedAt') || undefined,
		error: entityText(row, 'error') || undefined
	};
}
function parsePage(value: unknown): AssetPage {
	const data = object(value);
	if (!Array.isArray(data.data) || data.data.length > 100)
		throw new Error('Invalid asset page returned by the data service.');
	return {
		data: data.data.map(parseAsset),
		nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null
	};
}
function parseRecord(value: unknown): AssetRecord {
	const data = object(value);
	return {
		asset: parseAsset(data.asset),
		metadata: parseMetadata(data.metadata)
	};
}

function needsMetadataRefresh(metadata?: Metadata, attempt = 0) {
	if (metadata?.status === 'unavailable') return false;
	return metadata?.status === 'pending' || (!metadata?.logoUrl && attempt < 2);
}
function needsIssuerMetadataRefresh(metadata?: Metadata) {
	if (metadata?.error || metadata?.status === 'unavailable') return false;
	return metadata?.status === 'pending' || !metadata?.fetchedAt;
}

function normalizeAssetRef(value?: string): string | undefined {
	if (!value?.includes('%')) return value;
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function ExplorerAssetWorkspace({
	assetRef,
	issuerId,
	initialFilters = EMPTY_FILTERS
}: Props): React.JSX.Element {
	const canonicalAssetRef = normalizeAssetRef(assetRef);
	const browseOnly = Boolean(
		canonicalAssetRef &&
		canonicalAssetRef !== 'native' &&
		!canonicalAssetRef.includes(':') &&
		!/^C[A-Z2-7]{55}$/.test(canonicalAssetRef)
	);
	const initial = {
		...(browseOnly && canonicalAssetRef ? { q: canonicalAssetRef } : {}),
		...initialFilters
	};
	const [query, setQuery] = useState(initial.q ?? '');
	const [filters, setFilters] = useState<ExplorerFilters>(initial);
	const [draftFilters, setDraftFilters] = useState<ExplorerFilters>(initial);
	const [page, setPage] = useState<AssetPage | null>(null);
	const [cursor, setCursor] = useState<string | null>(null);
	const [detail, setDetail] = useState<AssetRecord | null>(null);
	const [issuer, setIssuer] = useState<AssetRecord | null>(null);
	const [issuerAssets, setIssuerAssets] = useState<AssetPage | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);
	const requestedCursor = useRef<string | null>(null);

	useEffect(() => {
		const abort = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let startedAt = Date.now();
		let pollAttempt = 0;

		const scheduleMetadataRefresh = (
			metadata?: Metadata,
			issuerMetadata = false
		) => {
			if (
				issuerMetadata
					? !needsIssuerMetadataRefresh(metadata)
					: !needsMetadataRefresh(metadata, pollAttempt)
			)
				return;
			const elapsed = Date.now() - startedAt;
			if (elapsed >= 60_000) return;
			const delay =
				POLL_DELAYS[Math.min(pollAttempt, POLL_DELAYS.length - 1)] ?? 15_000;
			pollAttempt += 1;
			timer = setTimeout(() => void load(), Math.min(delay, 60_000 - elapsed));
		};
		async function load(): Promise<void> {
			setBusy(true);
			setError(null);
			try {
				if (canonicalAssetRef && !browseOnly) {
					const record = parseRecord(
						await requestExplorerJson(
							'/v1/assets/' + encodeURIComponent(canonicalAssetRef),
							abort.signal
						)
					);
					setDetail(record);
					scheduleMetadataRefresh(record.metadata);
				} else if (issuerId) {
					const data = object(
						await requestExplorerJson(
							'/v1/issuers/' + encodeURIComponent(issuerId),
							abort.signal
						)
					);
					const issuerRow = object(data.issuer);
					const metadata = parseMetadata(data.metadata);
					setIssuer(
						parseRecord({
							asset: {
								id: entityText(issuerRow, 'id') || issuerId,
								kind: 'classic',
								issuer: issuerId
							},
							metadata
						})
					);
					if (data.assets) setIssuerAssets(parsePage(data.assets));
					scheduleMetadataRefresh(metadata, true);
				} else {
					const params = new URLSearchParams({ limit: '25', ...filters });
					if (requestedCursor.current)
						params.set('cursor', requestedCursor.current);
					const next = parsePage(
						await requestExplorerJson('/v1/assets?' + params, abort.signal)
					);
					setPage((current) =>
						requestedCursor.current && current
							? { ...next, data: [...current.data, ...next.data] }
							: next
					);
					requestedCursor.current = next.nextCursor;
					setCursor(next.nextCursor);
				}
			} catch (cause) {
				if (!abort.signal.aborted)
					setError(
						cause instanceof Error ? cause.message : 'Asset request failed.'
					);
			} finally {
				if (!abort.signal.aborted) setBusy(false);
			}
		}
		void load();
		return () => {
			abort.abort();
			if (timer) clearTimeout(timer);
		};
	}, [canonicalAssetRef, browseOnly, issuerId, filters, reload]);

	const search = (next: ExplorerFilters) => {
		requestedCursor.current = null;
		setFilters(next);
		setDraftFilters(next);
		setCursor(null);
		setPage(null);
		const params = new URLSearchParams(
			Object.entries(next).filter(([, value]) => value.trim())
		);
		window.history.replaceState(
			null,
			'',
			'/explorer/assets' + (params.size ? '?' + params : '')
		);
		setReload((value) => value + 1);
	};
	const refresh = () => setReload((value) => value + 1);
	const heading = browseOnly
		? 'Matches for ' + canonicalAssetRef
		: canonicalAssetRef
			? 'Overview'
			: issuerId
				? 'Issuer details'
				: 'Asset discovery';

	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="assets" />
			<section className={styles.panel} aria-busy={busy}>
				<div className={ui.heading}>
					<div>
						<h2>{heading}</h2>
						{!issuerId && (!canonicalAssetRef || browseOnly) && (
							<p className={styles.muted}>
								Search by asset code, issuer or contract address.
							</p>
						)}
					</div>
					{(canonicalAssetRef || issuerId) && (
						<Link
							href={
								'/explorer/assets' +
								(Object.keys(initialFilters).length
									? '?' + new URLSearchParams(initialFilters)
									: '')
							}
						>
							Browse all assets
						</Link>
					)}
				</div>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
				{(!canonicalAssetRef || browseOnly) && !issuerId && (
					<>
						<form
							className={ui.search}
							onSubmit={(event) => {
								event.preventDefault();
								search({ ...draftFilters, q: query.trim() });
							}}
						>
							<input
								aria-label="Search assets"
								placeholder="Asset code, G-address, or C-address"
								value={query}
								onChange={(event) => setQuery(event.currentTarget.value)}
							/>
							<button disabled={busy} type="submit">
								{busy ? 'Searching…' : 'Search assets'}
							</button>
						</form>
						<details className={ui.filters}>
							<summary>
								Observed range filters
								<span>Optional first/last ledger and from/to time</span>
							</summary>
							<div className={styles.form}>
								<label>
									First observed ledger
									<input
										type="number"
										value={draftFilters.min_ledger ?? ''}
										onChange={(event) =>
											setDraftFilters({
												...draftFilters,
												min_ledger: event.currentTarget.value
											})
										}
									/>
								</label>
								<label>
									Last observed ledger
									<input
										type="number"
										value={draftFilters.max_ledger ?? ''}
										onChange={(event) =>
											setDraftFilters({
												...draftFilters,
												max_ledger: event.currentTarget.value
											})
										}
									/>
								</label>
								<label>
									From time
									<input
										type="datetime-local"
										value={localDate(draftFilters.start_time ?? '')}
										onChange={(event) =>
											setDraftFilters({
												...draftFilters,
												start_time: isoDate(event.currentTarget.value)
											})
										}
									/>
								</label>
								<label>
									To time
									<input
										type="datetime-local"
										value={localDate(draftFilters.end_time ?? '')}
										onChange={(event) =>
											setDraftFilters({
												...draftFilters,
												end_time: isoDate(event.currentTarget.value)
											})
										}
									/>
								</label>
							</div>
							<div className={styles.actions}>
								<button
									disabled={busy}
									onClick={() => search({ ...draftFilters, q: query.trim() })}
								>
									Apply observed range
								</button>
								<button
									disabled={busy}
									onClick={() => {
										setQuery('');
										search({});
									}}
								>
									Clear filters
								</button>
							</div>
						</details>
						{page && <AssetTable assets={page.data} filters={filters} />}
						{page && (
							<div className={styles.actions}>
								<span>{page.data.length} assets shown</span>
								<button
									disabled={busy || !cursor}
									onClick={() => setReload((value) => value + 1)}
								>
									{busy ? 'Loading…' : 'Load more'}
								</button>
							</div>
						)}
					</>
				)}
				{canonicalAssetRef && !browseOnly && detail && (
					<>
						<AssetDetails
							record={detail}
							onRefresh={refresh}
							pending={needsMetadataRefresh(detail.metadata, 0)}
						/>
						<ExplorerAssetTabs record={detail} />
					</>
				)}
				{issuerId && issuer && (
					<IssuerDetails
						issuerId={issuerId}
						record={issuer}
						assets={issuerAssets}
						onRefresh={refresh}
						pending={needsIssuerMetadataRefresh(issuer.metadata)}
					/>
				)}
				{busy && !page && !detail && !issuer && (
					<p role="status">Loading asset data…</p>
				)}
			</section>
		</div>
	);
}
