import Link from 'next/link';
import {
	analyticsCollections,
	buildEntityHref
} from '../../api/explorer-analytics';
import { titleCase } from './explorer-entity-config';
import styles from './explorer-entity.module.css';
export function ExplorerEntityNavigation({
	active
}: {
	readonly active?: string;
}): React.JSX.Element {
	return (
		<nav className={styles.navigation} aria-label="Explore blockchain">
			<Link
				href="/explorer"
				aria-current={!active || active === 'transactions' ? 'page' : undefined}
			>
				Transactions
			</Link>
			<Link
				href="/explorer/transfers"
				aria-current={active === 'transfers' ? 'page' : undefined}
			>
				Transfers
			</Link>
			{analyticsCollections.map((collection) => (
				<Link
					key={collection}
					href={buildEntityHref(collection)}
					aria-current={active === collection ? 'page' : undefined}
				>
					{titleCase(collection)}
				</Link>
			))}
		</nav>
	);
}
