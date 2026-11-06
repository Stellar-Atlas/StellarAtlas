import { buildEntityHref } from '../../api/explorer-analytics';
import type { IssuerDomainEvidence } from '../../api/issuer-domain';
import { LocalDateTime } from '../local-date-time';
import { ExplorerLink } from './explorer-investigation';
import styles from './explorer-issuer-domain.module.css';

const associationLabels = {
	corroborated: 'Index and TOML agree',
	mismatch: 'Index and TOML disagree',
	indexed_only: 'Indexed home domain',
	toml_only: 'TOML claim only',
	unavailable: 'Current association unavailable'
};
const assetTomlLabels = {
	listed: 'Listed in TOML',
	not_listed: 'Not listed in TOML',
	unavailable: 'TOML listing unavailable'
};

export function IssuerDomainResults({ evidence }: { readonly evidence: IssuerDomainEvidence }): React.JSX.Element {
	const { accounts, catalogue, toml } = evidence;
	const noEvidence = evidence.homeDomainIndex === 'unavailable' && !toml.accountsIndexed;
	const limited = evidence.homeDomainIndex !== 'available' || catalogue.status !== 'available' ||
		toml.status !== 'available' || !toml.accountsIndexed;
	return (
		<div className={styles.results}>
			<h2 className={styles.wrap}>{evidence.domain}</h2>
			<p className={styles.muted}>Cached evidence only. Publisher claims do not verify asset ownership or backing.</p>
			<dl className={styles.sources}>
				<div><dt>Home-domain index</dt><dd>{evidence.homeDomainIndex}</dd></div>
				<div><dt>Asset catalogue</dt><dd>{catalogue.status}{catalogue.generatedAt && <> · <LocalDateTime dateTime={catalogue.generatedAt} /></>}</dd></div>
				<div><dt>Publisher’s stellar.toml</dt><dd>{toml.status}{toml.fetchedAt && <> · <LocalDateTime dateTime={toml.fetchedAt} /></>}
					{!toml.accountsIndexed && <small>Account claims not fully indexed</small>}</dd></div>
			</dl>
			{accounts.length === 0 ? <p role="status">{noEvidence ? 'Issuer-domain evidence is unavailable for this hostname.' :
				limited ? 'No accounts found in the available evidence. Coverage is incomplete.' :
					'No accounts found in the cached evidence.'}</p> :
				<p role="status">{accounts.length} {accounts.length === 1 ? 'account' : 'accounts'} shown.
					{evidence.accountsTruncated ? ' More accounts matched than can be shown.' : ''}</p>}
			<ul className={styles.accounts}>{accounts.map(account => (
				<li key={account.accountId} className={styles.account}>
					<div className={styles.accountHeading}>
						<h3><ExplorerLink className={styles.identifier} href={buildEntityHref('accounts', account.accountId)}>
							{account.accountId}</ExplorerLink></h3>
						<span className={styles.badge}>{associationLabels[account.association]}</span>
					</div>
					<p className={styles.wrap}><span className={styles.muted}>Indexed home domain: </span>
						{account.homeDomain?.domain ?? 'None recorded'}
						{account.homeDomain && <> · {account.homeDomain.status}
							{account.homeDomain.observedAt && <> · <LocalDateTime dateTime={account.homeDomain.observedAt} /></>}</>}
					</p>
					{account.tomlClaims.length > 0 && <p>Publisher lists this account in <code>{account.tomlClaims.join(', ')}</code>.</p>}
					{account.assets.length > 0 && <ul className={styles.assets}>{account.assets.map(asset => (
						<li key={asset.id}>
							<ExplorerLink href={buildEntityHref('assets', asset.id)}>{asset.code}</ExplorerLink>
							<span className={styles.muted}>{asset.ledger === null ? 'Not observed in this catalogue' :
								<>Last observed in ledger <ExplorerLink href={buildEntityHref('ledgers', String(asset.ledger))}>{asset.ledger.toLocaleString('en-US')}</ExplorerLink></>}
							</span>
							<span className={styles.muted}>{assetTomlLabels[asset.toml]}</span>
						</li>
					))}</ul>}
					{account.assetsTruncated && <p className={styles.muted}>More matching assets are not shown.</p>}
					<ExplorerLink href={buildEntityHref('issuers', account.accountId)}>Issuer details →</ExplorerLink>
				</li>
			))}</ul>
		</div>
	);
}
