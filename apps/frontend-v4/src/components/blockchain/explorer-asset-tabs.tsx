'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { AssetRecord } from './explorer-asset-types';
import { isContractAccount } from '../../domain/classic-account';
import { ParsedIssuerMetadata } from './explorer-issuer-metadata';
import { ExplorerAssetHolders } from './explorer-asset-holders';
import { ExplorerAssetMarkets } from './explorer-asset-markets';
import { ExplorerAssetActivity } from './explorer-asset-activity';
import { ExplorerContractActivity } from './explorer-contract-activity';
import { ExplorerSimilarAssets } from './explorer-similar-assets';
import { ExplorerAssetReports } from './explorer-asset-reports';
import {
	assetTabHref,
	assetTabOptions,
	readAssetTab,
	type AssetTab
} from './asset-tab-route';
import ui from './explorer-asset-workspace.module.css';

export function ExplorerAssetTabs({
	record
}: {
	record: AssetRecord;
}): React.JSX.Element {
	const pathname = usePathname();
	const params = useSearchParams();
	const tab = readAssetTab(params.get('tab'));
	const setTab = (next: AssetTab) => {
		const href = assetTabHref(
			pathname,
			window.location.search,
			next,
			window.location.hash
		);
		if (
			href !==
			window.location.pathname + window.location.search + window.location.hash
		)
			window.history.pushState(null, '', href);
	};
	const { asset, metadata } = record;
	const contractId = asset.contractId || (asset.kind === 'contract' && isContractAccount(asset.id) ? asset.id : undefined);
	return (
		<div className={ui.assetTabs}>
			<nav className={ui.tabBar} aria-label="Asset sections">
				{assetTabOptions.map(({ label: value }) => (
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
			{tab === 'Contracts & events' && !contractId && (
				<section aria-label="Contract activity">
					<h3>Contract activity</h3>
					<p role="status">Contract address unavailable for this asset.</p>
				</section>
			)}
			{tab === 'Contracts & events' && contractId && (
				<>
					<h3>
						{asset.kind === 'contract'
							? 'Contract activity'
							: 'Stellar Asset Contract activity'}
					</h3>
					<Link
						className={ui.plainHash}
						href={'/explorer/contracts/' + contractId}
					>
						{contractId}
					</Link>
					<ExplorerContractActivity
						contractId={contractId}
						filters={{}}
						token={
							asset.kind === 'contract'
								? undefined
								: {
										contractId,
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
