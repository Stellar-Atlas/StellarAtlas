'use client';

import { ExplorerInvestigationScope, ExplorerLink as Link } from './explorer-investigation';
import {
	formatTransferAmount
} from '../../api/transfer-activity';
import type { Asset } from './explorer-asset-types';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-entity.module.css';
import ui from './explorer-asset-workspace.module.css';
import { useAssetTransferActivity } from './use-asset-transfer-activity';

function Wallet({ address }: { address: string | null }): React.JSX.Element {
	if (!address) return <>—</>;
	if (!/^[GC][A-Z2-7]{55}$/.test(address)) return <span className={ui.plainHash}>{address}</span>;
	return (
		<Link
			className={ui.plainHash}
			href={
				'/explorer/' +
				(address.startsWith('C') ? 'contracts' : 'accounts') +
				'/' +
				encodeURIComponent(address)
			}
		>
			{address}
		</Link>
	);
}

export function ExplorerAssetActivity({
	asset
}: {
	asset: Asset;
}): React.JSX.Element {
	return <AssetActivity key={JSON.stringify([asset.id,asset.kind,asset.contractId])} asset={asset} />;
}
function AssetActivity({asset}:{readonly asset:Asset}): React.JSX.Element {
	const latest = asset.lastObservedLedger;
	const activity = useAssetTransferActivity(asset);
	const {before,page,busy,error}=activity;
	return (
		<ExplorerInvestigationScope origin={activity.origin}><section className={ui.holderSection} aria-label="Asset transfer activity" aria-busy={busy}>
			<div className={ui.sectionHeading}>
				<h3>Transfers &amp; transactions</h3>
				<span className={ui.observationLabel}>Published activity</span>
			</div>
			<div className={styles.actions}>
				<button
					disabled={busy || before === undefined || before <= 2}
					onClick={() =>
						activity.window(
							before === undefined ? undefined : Math.max(2, before - 2048)
						)
					}
				>
					Earlier activity
				</button>
				<button disabled={busy} onClick={() => activity.window(latest)}>
					Latest indexed activity
				</button>
				{busy && <button type="button" onClick={activity.cancel}>Cancel activity</button>}
			</div>
			{busy && <p role="status">Loading transfers…</p>}
			{error && (
				<p className={styles.error} role="alert">
					{error}
					{activity.retry && <button type="button" disabled={busy} onClick={activity.retry}>Retry activity</button>}
				</p>
			)}
			{page && (
				<>
					<div className={styles.tableWrap}>
						<table className={styles.table}>
							<thead>
								<tr>
									<th scope="col">Time</th>
									<th scope="col">From</th>
									<th scope="col">To</th>
									<th scope="col" className={ui.numeric}>Amount</th>
									<th scope="col">Transaction</th>
									<th scope="col">Ledger</th>
								</tr>
							</thead>
							<tbody>
								{page.transfers.map((row) => (
									<tr key={row.id}>
										<td data-label="Time"><div>
											<LocalDateTime dateTime={row.closedAt} />
										</div></td>
										<td data-label="From"><div>
											<Wallet address={row.from} />
										</div></td>
										<td data-label="To"><div>
											<Wallet address={row.to} />
											{row.toMuxed && <small className={ui.plainHash}>{row.toMuxed}</small>}
										</div></td>
										<td data-label="Amount" className={ui.numeric}><div>
											{formatTransferAmount(row.amountRaw, row.amountScale)}
											{row.amountScale === null && <small>Decimals not recorded</small>}
										</div></td>
										<td data-label="Transaction"><div>
											<Link
												className={ui.plainHash}
												href={'/explorer/transactions/' + row.transactionHash + '?ledger_sequence=' + row.ledgerSequence}
											>
												{row.transactionHash}
											</Link>
											{row.operationId && (
												<small>
													<Link
														href={'/explorer/operations/' + row.operationId + '?min_ledger=' + row.ledgerSequence + '&max_ledger=' + row.ledgerSequence}
													>
														Operation {row.operationId}
													</Link>
												</small>
											)}
										</div></td>
										<td data-label="Ledger"><div>
											<Link href={'/explorer/ledgers/' + row.ledgerSequence}>
												{row.ledgerSequence.toLocaleString()}
											</Link>
										</div></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
					{!page.transfers.length && (
						<p className={styles.muted}>
							No transfers in this indexed window. Earlier activity may exist.
						</p>
					)}
					<span className={ui.observationLabel}>Partial indexed history</span>
				</>
			)}
					<div className={styles.actions}>
						<button
							disabled={busy || !activity.previous}
							onClick={activity.previous ?? undefined}
						>
							Previous
						</button>
						<button
							disabled={busy || !activity.next}
							onClick={activity.next ?? undefined}
						>
							Next
						</button>
						<button type="button" disabled={busy} onClick={activity.first}>First page</button>
					</div>
		</section></ExplorerInvestigationScope>
	);
}
