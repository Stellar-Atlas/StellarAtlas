'use client';

import { useRef, useState } from 'react';
import { addressDifference, type AddressPoisoningMatch } from '../../domain/address-poisoning';
import { ExplorerLink } from '../blockchain/explorer-investigation';
import { buildEntityHref } from '../../api/explorer-analytics';
import styles from './address-poisoning-notice.module.css';

function AddressComparison({ match }: { readonly match: AddressPoisoningMatch }): React.JSX.Element {
	return <dl className={styles.comparison}>{([
		['Prior payment recipient', match.intendedAddress, match.attackingAddress],
		['Attacking address', match.attackingAddress, match.intendedAddress]
	] as const).map(([label, address, other]) => <div key={label}>
		<dt>{label}</dt><dd><ExplorerLink href={buildEntityHref('accounts', address)}>
			{addressDifference(address, other).map((part, i) => part.different
				? <mark key={i}>{part.text}</mark> : <span key={i}>{part.text}</span>)}
		</ExplorerLink></dd>
	</div>)}</dl>;
}

export function AddressPoisoningNotice({ matches }: { readonly matches: readonly AddressPoisoningMatch[] }): React.JSX.Element | null {
	if (!matches.length) return null;
	return <section className={styles.notice} aria-label="Address-poisoning warnings">
		<h3>Address-poisoning attempt detected</h3>
		{matches.map(match => <div className={styles.match} key={match.attackingAddress}>
			<p>After this account paid the recipient, a different look-alike address sent dust back.</p>
			<AddressComparison match={match} />
			<p className={styles.links}><ExplorerLink href={buildEntityHref('transactions', match.payment.transactionHash,
				{ ledger_sequence: String(match.payment.ledgerSequence) })}>Prior payment</ExplorerLink>
				<ExplorerLink href={buildEntityHref('transactions', match.dust.transactionHash,
					{ ledger_sequence: String(match.dust.ledgerSequence) })}>Incoming dust transaction</ExplorerLink></p>
		</div>)}
	</section>;
}

/** All app-controlled copies of a flagged address on this investigation share this guard. */
export function TransferAddress({ address, match }: {
	readonly address: string | null;
	readonly match?: AddressPoisoningMatch;
}): React.JSX.Element {
	const dialog = useRef<HTMLDialogElement>(null);
	const cancel = useRef<HTMLButtonElement>(null);
	const [status, setStatus] = useState('');
	const flagged = match?.attackingAddress === address;
	const copy = async (): Promise<void> => {
		if (!address) return;
		try { await navigator.clipboard.writeText(address); setStatus('Copied'); dialog.current?.close(); }
		catch { setStatus('Copy failed. Select the full address to copy it manually.'); }
	};
	if (!address) return <>Not recorded</>;
	return <div className={styles.address}>
		<ExplorerLink href={buildEntityHref(address.startsWith('C') ? 'contracts' : 'accounts', address)}>{address}</ExplorerLink>
		<button type="button" aria-label={flagged ? 'Review before copying attacking address' : 'Copy address'}
			onClick={() => { setStatus(''); if (flagged) { dialog.current?.showModal(); cancel.current?.focus(); } else void copy(); }}>Copy</button>
		{status && <small role="status">{status}</small>}
		{flagged && <dialog ref={dialog} className={styles.dialog} aria-label="Confirm copying attacking address">
			<h3>Address-poisoning attempt detected</h3>
			<p>You are about to copy the attacking address, not the prior payment recipient.</p>
			<AddressComparison match={match} />
			<div className={styles.links}><button type="button" ref={cancel} onClick={() => dialog.current?.close()}>Cancel</button>
				<button type="button" onClick={() => void copy()}>Copy attacking address anyway</button></div>
		</dialog>}
	</div>;
}
