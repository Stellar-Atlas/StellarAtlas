'use client';
import { ExplorerLink as Link } from './explorer-investigation';
import { useCallback, useEffect, useRef } from 'react';
import { initialExplorerSearch } from './blockchain-explorer-state';
import { SearchResultView } from './blockchain-explorer-results';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import {
	buildEntityHref,
	requestExplorerJson
} from '../../api/explorer-analytics';
import {
	buildAnalyticsLedgerPath,
	parseAnalyticsLedgerLookup
} from '../../api/explorer-record-lookup';
import { ExplorerAccountAssets } from './explorer-account-assets';
import { ExplorerClaimablePositions } from './explorer-claimable-positions';
import { ExplorerAccountProtocolPosition } from './explorer-account-protocol-position';
import { ExplorerAccountFederation } from './explorer-account-federation';
import { ExplorerLedgerActivity } from './explorer-ledger-activity';
import { ExplorerAccountRelations } from './explorer-account-relations';
import { isClassicAccount, isContractAccount } from '../../domain/classic-account';
import styles from './explorer-entity.module.css';

export function ExplorerRecordLookup({
	collection,
	identifier,
	claimablePositionsEnabled = false,
	protocolPositionsEnabled = false
}: {
	readonly collection: 'accounts' | 'ledgers';
	readonly identifier: string;
	readonly claimablePositionsEnabled?: boolean;
	readonly protocolPositionsEnabled?: boolean;
}): React.JSX.Element {
	if (collection === 'accounts' && !isClassicAccount(identifier)) {
		const contract = isContractAccount(identifier);
		return <div className={styles.workspace}>
			<ExplorerEntityNavigation active="accounts" />
			<section className={styles.panel} aria-label={contract ? 'Contract account' : 'Invalid account address'}>
				<h2>{contract ? 'Contract ' + identifier : 'Invalid account address'}</h2>
				{contract ? <>
					<p className={styles.muted}>Contract balances are not supported in this account view.</p>
					<div className={styles.actions}><Link href={buildEntityHref('contracts', identifier)}>View contract</Link></div>
				</> : <>
					<p role="alert">Enter a checksum-valid Stellar G-address.</p>
					<div className={styles.actions}><Link collectionContext href="/explorer">Search explorer</Link></div>
				</>}
			</section>
		</div>;
	}
	return <RecordLookup key={`${collection}:${identifier}`} collection={collection} identifier={identifier}
		claimablePositionsEnabled={claimablePositionsEnabled} protocolPositionsEnabled={protocolPositionsEnabled} />;
}

function RecordLookup({
	collection,
	identifier,
	claimablePositionsEnabled,
	protocolPositionsEnabled
}: {
	readonly collection: 'accounts' | 'ledgers';
	readonly identifier: string;
	readonly claimablePositionsEnabled: boolean;
	readonly protocolPositionsEnabled: boolean;
}): React.JSX.Element {
	const search = useExplorerRequest(
		initialExplorerSearch,
		'The requested record could not be loaded.'
	);
	const ledgerController = useRef<AbortController | null>(null);
	useEffect(() => () => ledgerController.current?.abort(), []);
	const refresh = useCallback(
		() =>
			search.run(async () => {
				ledgerController.current?.abort();
				const controller = new AbortController();
				ledgerController.current = controller;
				try {
					const response = await requestExplorerJson(
						buildAnalyticsLedgerPath(identifier),
						controller.signal
					);
					return parseAnalyticsLedgerLookup(identifier, response);
				} finally {
					if (ledgerController.current === controller)
						ledgerController.current = null;
				}
			}),
		[search.run, identifier]
	);
	useEffect(() => {
		if (collection === 'ledgers') void refresh();
	}, [collection, refresh]);
	const filter: Readonly<Record<string, string>> =
		collection === 'accounts'
			? { source_account: identifier }
			: { min_ledger: identifier, max_ledger: identifier };
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active={collection} />
			<section className={styles.panel}>
				<h2>
					{collection === 'accounts' ? 'Account' : 'Ledger'} {identifier}
				</h2>
				{collection === 'accounts' && <ExplorerAccountFederation accountId={identifier} network="mainnet" active />}
				{collection === 'ledgers' && <ExplorerLedgerActivity ledger={identifier} />}
				{collection === 'ledgers' ? (
					<>
						<ExplorerRequestNotice
							error={search.error}
							loading={search.loading}
							onRetry={() => void refresh()}
						/>
						<SearchResultView result={search.result} />
					</>
				) : null}
				{collection === 'accounts' && <div className={styles.actions}>
					<Link href={buildEntityHref('operations', undefined, filter)}>
						Operations
					</Link>
					{collection === 'accounts' ? (
						<>
							<Link
								href={buildEntityHref('transfers', undefined, {
									account: identifier
								})}
							>
								Transfers
							</Link>
							<Link
								href={buildEntityHref('offers', undefined, {
									seller: identifier
								})}
							>
								Offer history
							</Link>
							<Link
								href={buildEntityHref('trades', undefined, {
									seller: identifier
								})}
							>
								Trades as seller
							</Link>
							<Link
								href={buildEntityHref('trades', undefined, {
									buyer: identifier
								})}
							>
								Trades as buyer
							</Link>
						</>
					) : null}
				</div>}
				{collection === 'accounts' && <ExplorerAccountRelations account={identifier} />}
			</section>
			{collection === 'accounts' && (
				<ExplorerAccountAssets key={identifier} account={identifier} />
			)}
			{collection === 'accounts' && claimablePositionsEnabled && <ExplorerClaimablePositions account={identifier} />}
			{collection === 'accounts' && protocolPositionsEnabled && <ExplorerAccountProtocolPosition account={identifier} />}
		</div>
	);
}
