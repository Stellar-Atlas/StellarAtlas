import type { TransferActivity } from '../../api/transfer-activity';
import { formatTransferAmount } from '../../api/transfer-activity';
import { EntityLink } from './explorer-entity-table';
import { LocalDateTime } from '../local-date-time';
import styles from './explorer-entity.module.css';

function Wallet({ address }: { readonly address: string | null }): React.JSX.Element {
	return !address ? <>Not recorded</> : /^[GC][A-Z2-7]{55}$/.test(address)
		? <EntityLink collection={address.startsWith('C') ? 'contracts' : 'accounts'} id={address} />
		: <span className={styles.hash}>{address}</span>;
}
/** A bounded page, not a client-side inventory or net-balance calculation. */
export function ExplorerTransferTable({ rows }: { readonly rows: readonly TransferActivity[] }): React.JSX.Element {
	return <div className={styles.tableWrap}><p className={styles.muted}>Indexed transfers · {rows.length} on this page</p><table className={styles.table} aria-label="Indexed transfers">
		<thead><tr><th scope="col">Asset / amount</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Details</th></tr></thead>
		<tbody>{rows.map(row => <tr key={row.id}>
			<td data-label="Asset / amount"><div>
				<EntityLink collection="assets" id={row.asset.id} label={row.asset.id === 'native' ? 'XLM' : row.asset.code || row.asset.id} />
				<p className={styles.hash}>{formatTransferAmount(row.amountRaw, row.amountScale)}</p>
				{row.asset.code && row.asset.issuer && <Wallet address={row.asset.issuer} />}
				{row.amountScale === null && <small>Decimals not recorded</small>}
			</div></td>
			<td data-label="From"><div><Wallet address={row.from} /></div></td>
			<td data-label="To"><div><Wallet address={row.to} />{row.toMuxed && <p className={styles.hash}>{row.toMuxed}</p>}</div></td>
			<td data-label="Details"><div><span>{row.eventTopic}</span>
				<details><summary>Transfer details</summary><dl className={styles.details}>
					<dt>Asset ID</dt><dd><EntityLink collection="assets" id={row.asset.id} /></dd>
					<dt>Raw amount</dt><dd>{row.amountRaw}</dd>
					<dt>Decimals</dt><dd>{row.amountScale ?? 'Not recorded'}</dd>
					<dt>Contract</dt><dd><Wallet address={row.contractId} /></dd>
					<dt>Operation</dt><dd>{row.operationId ? <EntityLink collection="operations" id={row.operationId} filters={{min_ledger:String(row.ledgerSequence),max_ledger:String(row.ledgerSequence)}} /> : 'Not recorded'}</dd>
					<dt>Transaction</dt><dd><EntityLink collection="transactions" id={row.transactionHash} filters={{ledger_sequence:String(row.ledgerSequence)}} /></dd>
					<dt>Ledger</dt><dd><EntityLink collection="ledgers" id={String(row.ledgerSequence)} label={row.ledgerSequence.toLocaleString('en-US')} /></dd>
					<dt>Closed</dt><dd><LocalDateTime dateTime={row.closedAt} /></dd>
				</dl></details>
			</div></td>
		</tr>)}</tbody>
	</table></div>;
}
