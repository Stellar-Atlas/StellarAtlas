'use client';

import { ExplorerLink as Link } from './explorer-investigation';
import { useState } from 'react';
import type { ExplorerFilters } from '../../api/explorer-analytics';
import type {
	Asset,
	AssetPage,
	AssetRecord,
	Metadata
} from './explorer-asset-types';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';
import { ParsedIssuerMetadata } from './explorer-issuer-metadata';

const EMPTY_FILTERS: ExplorerFilters = Object.freeze({});

function assetHref(asset: Asset, filters: ExplorerFilters = {}) {
	const query = new URLSearchParams(
		Object.entries(filters).filter(([, value]) => value.trim())
	);
	return (
		'/explorer/assets/' +
		encodeURIComponent(asset.id) +
		(query.size ? '?' + query : '')
	);
}
function logoUrl(asset: Asset, metadata?: Metadata) {
	const value = metadata?.logoUrl ?? asset.logoUrl;
	if (!value) return undefined;
	if (value.startsWith('/')) return value;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.toString() : undefined;
	} catch {
		return undefined;
	}
}
export function Logo({
	asset,
	metadata
}: {
	asset: Asset;
	metadata?: Metadata;
}): React.JSX.Element {
	const src = logoUrl(asset, metadata);
	return src ? (
		<img
			className={ui.logo}
			src={src}
			alt="Issuer-provided logo"
			title="Issuer-provided logo"
			loading="lazy"
		/>
	) : (
		<span className={ui.logoFallback} aria-hidden="true">
			{asset.code?.slice(0, 1) ?? '✦'}
		</span>
	);
}
function Address({
	value,
	href
}: {
	value: string;
	href?: string;
}): React.JSX.Element {
	const [copied, setCopied] = useState(false);
	return (
		<span className={ui.address}>
			{href ? (
				<Link href={href}>
					<code>{value}</code>
				</Link>
			) : (
				<code>{value}</code>
			)}
			<button
				type="button"
				className={ui.copyButton}
				aria-label={copied ? 'Address copied' : 'Copy address'}
				onClick={() =>
					void navigator.clipboard.writeText(value).then(() => setCopied(true))
				}
			>
				{copied ? 'Copied' : 'Copy'}
			</button>
		</span>
	);
}
export function localDate(value: string) {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.valueOf())) return '';
	return new Date(date.valueOf() - date.getTimezoneOffset() * 60000)
		.toISOString()
		.slice(0, 16);
}
export function isoDate(value: string) {
	if (!value) return '';
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? '' : date.toISOString();
}
export function AssetTable({
	assets,
	filters = EMPTY_FILTERS
}: {
	assets: readonly Asset[];
	filters?: ExplorerFilters;
}): React.JSX.Element {
	if (!assets.length)
		return (
			<p className={styles.empty}>
				No assets matched. Try a code, full issuer address, or C-address.
			</p>
		);
	return (
		<div className={styles.tableWrap}>
			<table className={`${styles.table} ${ui.assetTable}`}>
				<thead>
					<tr>
						<th>Asset</th>
						<th>Type</th>
						<th>Issuer / contract</th>
						<th>First observed</th>
						<th>Last observed</th>
					</tr>
				</thead>
				<tbody>
					{assets.map((asset) => (
						<tr key={asset.id}>
							<td>
								<Link href={assetHref(asset, filters)}>
									<span className={ui.assetName}>
										<Logo asset={asset} />
										<span>
											<strong>
												{asset.code ??
													(asset.kind === 'native' ? 'XLM' : asset.id)}
											</strong>
										</span>
									</span>
								</Link>
							</td>
							<td>
								{asset.kind === 'classic'
									? 'Classic asset'
									: asset.kind === 'native'
										? 'Native asset'
										: 'Contract'}
							</td>
							<td>
								{asset.issuer ? (
									<Link
										href={
											'/explorer/issuers/' + encodeURIComponent(asset.issuer)
										}
									>
										<code>{asset.issuer}</code>
									</Link>
								) : asset.contractId ? (
									<Link
										href={
											'/explorer/contracts/' +
											encodeURIComponent(asset.contractId)
										}
									>
										<code>{asset.contractId}</code>
									</Link>
								) : (
									'—'
								)}
							</td>
							<td>
								{asset.firstObservedLedger !== undefined ? (
									<Link href={'/explorer/ledgers/' + asset.firstObservedLedger}>
										{asset.firstObservedLedger}
									</Link>
								) : (
									'—'
								)}
								{asset.firstObservedAt && (
									<small>
										{new Date(asset.firstObservedAt).toLocaleString()}
									</small>
								)}
							</td>
							<td>
								{asset.lastObservedLedger !== undefined ? (
									<Link href={'/explorer/ledgers/' + asset.lastObservedLedger}>
										{asset.lastObservedLedger}
									</Link>
								) : (
									'—'
								)}
								{asset.lastObservedAt && (
									<small>
										{new Date(asset.lastObservedAt).toLocaleString()}
									</small>
								)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
			<p className={styles.muted}>
				Observed bounds describe indexed history, not asset creation dates.
			</p>
		</div>
	);
}

function PendingMetadata({
	onRefresh
}: {
	onRefresh: () => void;
}): React.JSX.Element {
	return (
		<p className={ui.pending} role="status">
			Fetching issuer metadata…
			<button type="button" onClick={onRefresh}>
				Refresh now
			</button>
		</p>
	);
}
export function AssetDetails({
	record,
	onRefresh,
	pending
}: {
	record: AssetRecord;
	onRefresh: () => void;
	pending: boolean;
}): React.JSX.Element {
	const { asset, metadata } = record;
	return (
		<div className={ui.details}>
			<div className={ui.assetTitle}>
				<Logo asset={asset} metadata={metadata} />
				<div>
					<h3>
						{asset.code ??
							(asset.kind === 'contract' ? asset.contractId : undefined) ??
							'Asset'}
					</h3>
					<p>
						{asset.kind === 'classic'
							? 'Classic asset'
							: asset.kind === 'native'
								? 'Native asset'
								: 'Contract'}
					</p>
				</div>
			</div>
			{pending && <PendingMetadata onRefresh={onRefresh} />}
			<dl className={ui.identityFields}>
				<dt>Asset ID</dt>
				<dd>
					<Address value={asset.id} />
				</dd>
				{asset.issuer && (
					<>
						<dt>Issuer</dt>
						<dd>
							<Address
								value={asset.issuer}
								href={'/explorer/issuers/' + encodeURIComponent(asset.issuer)}
							/>
						</dd>
					</>
				)}
				{asset.contractId && (
					<>
						<dt>
							{asset.kind === 'classic' || asset.kind === 'native'
								? 'SAC address'
								: 'Contract'}
						</dt>
						<dd>
							<Address
								value={asset.contractId}
								href={
									'/explorer/contracts/' + encodeURIComponent(asset.contractId)
								}
							/>
						</dd>
					</>
				)}
				{metadata?.homeDomain && (
					<>
						<dt>Issuer home domain</dt>
						<dd>{metadata.homeDomain}</dd>
					</>
				)}
				{asset.firstObservedLedger !== undefined && (
					<>
						<dt>First indexed ledger</dt>
						<dd>
							<Link href={'/explorer/ledgers/' + asset.firstObservedLedger}>
								{asset.firstObservedLedger.toLocaleString()}
							</Link>
						</dd>
					</>
				)}
				{asset.lastObservedLedger !== undefined && (
					<>
						<dt>Latest indexed ledger</dt>
						<dd>
							<Link href={'/explorer/ledgers/' + asset.lastObservedLedger}>
								{asset.lastObservedLedger.toLocaleString()}
							</Link>
						</dd>
					</>
				)}
			</dl>
			<div className={styles.actions}>
				<Link
					href={'/explorer/transfers?asset=' + encodeURIComponent(asset.id)}
				>
					Explore transfers
				</Link>
			</div>
		</div>
	);
}
export function IssuerDetails({
	issuerId,
	record,
	assets,
	onRefresh,
	pending
}: {
	issuerId: string;
	record: AssetRecord;
	assets: AssetPage | null;
	onRefresh: () => void;
	pending: boolean;
}): React.JSX.Element {
	const metadata = record.metadata;
	return (
		<div className={ui.details}>
			<Address
				value={issuerId}
				href={'/explorer/accounts/' + encodeURIComponent(issuerId)}
			/>
			{pending && <PendingMetadata onRefresh={onRefresh} />}
			<ParsedIssuerMetadata metadata={metadata} />
			<h3>Indexed assets</h3>
			{assets ? (
				<AssetTable assets={assets.data} />
			) : (
				<p className={styles.muted}>
					No published assets returned for this issuer.
				</p>
			)}
		</div>
	);
}
