'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AssetRecord } from './explorer-asset-types';
import { ParsedIssuerMetadata } from './explorer-issuer-metadata';
import { ExplorerAssetHolders } from './explorer-asset-holders';
import { ExplorerAssetMarkets } from './explorer-asset-markets';
import { ExplorerAssetActivity } from './explorer-asset-activity';
import { ExplorerContractActivity } from './explorer-contract-activity';
import { ExplorerSimilarAssets } from './explorer-similar-assets';
import { ExplorerAssetReports } from './explorer-asset-reports';
import ui from './explorer-asset-workspace.module.css';

const TABS = [
	'Overview',
	'Holders',
	'Transfers',
	'Markets',
	'Contracts & events',
	'Rankings',
	'Balance history',
	'Same symbol'
] as const;
type Tab = (typeof TABS)[number];

export function ExplorerAssetTabs({
	record
}: {
	record: AssetRecord;
}): React.JSX.Element {
	const [tab, setTab] = useState<Tab>('Overview');
	const { asset, metadata } = record;
	return (
		<div className={ui.assetTabs}>
			<nav className={ui.tabBar} aria-label="Asset sections">
				{TABS.map((value) => (
					<button
						key={value}
						aria-pressed={tab === value}
						onClick={() => setTab(value)}
					>
						{value}
					</button>
				))}
			</nav>
			{tab === 'Overview' && (
				<>
					{metadata?.tomlUrl && <ParsedIssuerMetadata metadata={metadata} />}
					<div className={ui.quickLinks}>
						<button onClick={() => setTab('Holders')}>
							Holder distribution →
						</button>
						<button onClick={() => setTab('Transfers')}>
							Transfer history →
						</button>
						<button onClick={() => setTab('Markets')}>
							Trades &amp; liquidity pools →
						</button>
						{asset.issuer && (
							<Link href={'/explorer/issuers/' + asset.issuer}>
								Other assets from this issuer →
							</Link>
						)}
					</div>
					{asset.kind !== 'contract' && (
						<ExplorerAssetHolders identifier={asset.id} autoLoad />
					)}
				</>
			)}
			{tab === 'Holders' &&
				(asset.kind === 'contract' ? (
					<p>
						Holder indexing is not available for this contract’s storage format
						yet.
					</p>
				) : (
					<ExplorerAssetHolders identifier={asset.id} autoLoad />
				))}
			{tab === 'Transfers' && <ExplorerAssetActivity asset={asset} />}
			{tab === 'Rankings' && (
				<ExplorerAssetReports asset={asset.id} kind="rankings" />
			)}
			{tab === 'Balance history' && (
				<ExplorerAssetReports asset={asset.id} kind="balance-history" />
			)}
			{tab === 'Same symbol' && <ExplorerSimilarAssets asset={asset.id} />}
			{tab === 'Markets' &&
				(asset.kind === 'contract' ? (
					<p>
						Native order-book and pool records apply to classic assets. Contract
						market classification is not indexed yet.
					</p>
				) : (
					<ExplorerAssetMarkets asset={asset} />
				))}
			{tab === 'Contracts & events' && asset.contractId && (
				<>
					<h3>
						{asset.kind === 'contract'
							? 'Contract activity'
							: 'Stellar Asset Contract activity'}
					</h3>
					<Link
						className={ui.plainHash}
						href={'/explorer/contracts/' + asset.contractId}
					>
						{asset.contractId}
					</Link>
					<ExplorerContractActivity
						contractId={asset.contractId}
						filters={{}}
						token={
							asset.kind === 'contract'
								? undefined
								: {
										contractId: asset.contractId,
										assetId: asset.id,
										symbol: asset.code ?? 'XLM',
										decimals: 7
									}
						}
					/>
				</>
			)}
		</div>
	);
}
