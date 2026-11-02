import { buildEntityHref } from '../../api/explorer-analytics';
import { isClassicAccount } from '../../domain/classic-account';
import { ExplorerLink as Link } from './explorer-investigation';
import styles from './explorer-entity.module.css';

/** Existing bounded routes only; links do not fetch until opened. */
export function ExplorerAccountRelations({ account }: { readonly account: string }): React.JSX.Element | null {
	if (!isClassicAccount(account)) return null;
	return <section aria-label="Account relationships" className={styles.provenance}>
		<div className={styles.actions}>
			<Link href={buildEntityHref('issuers', account)}>Issuer details</Link>
			<Link href={buildEntityHref('assets', undefined, { issuer: account })}>Observed issued assets</Link>
			<Link href={buildEntityHref('operations', undefined, { source_account: account, type: 'create_account' })}>Funded account creations</Link>
		</div>
		<p className={styles.muted}>Creation operations use the selected history window.</p>
	</section>;
}
