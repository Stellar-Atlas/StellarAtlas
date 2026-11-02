'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import {
	AssetTable,
	AssetDetails,
	IssuerDetails
} from './explorer-asset-views';
import type {
	AssetPage,
	AssetRecord,
	Metadata
} from './explorer-asset-types';
import { useEffect, useState } from 'react';
import { parseAsset } from './asset-data';
import { ExplorerAssetDiscovery } from './explorer-asset-discovery';
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

export function ExplorerAssetWorkspace(props: Props): React.JSX.Element {
	const reference = normalizeAssetRef(props.assetRef);
	const browse = !props.issuerId && (!reference || reference !== 'native' && !reference.includes(':') && !/^C[A-Z2-7]{55}$/.test(reference));
	return browse
		? <ExplorerAssetDiscovery defaultQuery={reference} />
		: <ExplorerAssetRecordWorkspace key={reference ?? props.issuerId} {...props} />;
}

function ExplorerAssetRecordWorkspace({
	assetRef,
	issuerId,
	initialFilters = EMPTY_FILTERS
}: Props): React.JSX.Element {
	const canonicalAssetRef = normalizeAssetRef(assetRef);
	const [detail, setDetail] = useState<AssetRecord | null>(null);
	const [issuer, setIssuer] = useState<AssetRecord | null>(null);
	const [issuerAssets, setIssuerAssets] = useState<AssetPage | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);

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
				if (canonicalAssetRef) {
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
	}, [canonicalAssetRef, issuerId, reload]);

	const refresh = () => setReload((value) => value + 1);
	const heading = canonicalAssetRef ? 'Overview' : 'Issuer details';

	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="assets" />
			<section className={styles.panel} aria-busy={busy}>
				<div className={ui.heading}>
					<div>
						<h2>{heading}</h2>
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
				{canonicalAssetRef && detail && (
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
				{busy && !detail && !issuer && (
					<p role="status">Loading asset data…</p>
				)}
			</section>
		</div>
	);
}
