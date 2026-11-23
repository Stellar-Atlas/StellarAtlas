'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { verifiedContractsPath } from '../../api/verified-contract-catalogue';
import {
	analyticsCollections,
	buildEntityHref
} from '../../api/explorer-analytics';
import { titleCase } from './explorer-entity-config';
import styles from './explorer-entity.module.css';

const destinations = [
	{ id: 'transactions', label: 'Transactions', href: '/explorer' },
	{ id: 'transfers', label: 'Transfers', href: '/explorer/transfers' },
	...analyticsCollections.map(id => ({ id, label: titleCase(id), href: buildEntityHref(id) })),
	{ id: 'markets', label: 'Pair reports', href: '/explorer/markets' },
	{ id: 'issuers', label: 'Issuers', href: '/explorer/issuers' },
	{ id: 'contract-events', label: 'Contract events', href: '/explorer/contract-events' },
	{ id: 'verified-contracts', label: 'Verified contracts', href: verifiedContractsPath }
];

export function ExplorerEntityNavigation({
	active
}: {
	readonly active?: string;
}): React.JSX.Element {
	const disclosure = useRef<HTMLDetailsElement>(null);
	const summary = useRef<HTMLElement>(null);
	const current = active ?? 'transactions';
	const close = (): void => {
		if (disclosure.current?.open) {
			summary.current?.focus({ preventScroll: true });
			disclosure.current.open = false;
		}
	};
	const links = (compact: boolean) => destinations.map(({ id, label, href }) => (
		<Link key={id} href={href} prefetch={compact || id === 'verified-contracts' ? false : undefined}
			aria-current={current === id ? 'page' : undefined} onClick={compact ? close : undefined}>
			{label}
		</Link>
	));
	return (
		<nav className={styles.navigation} aria-label="Explore blockchain">
			<div className={styles.navigationLinks}>{links(false)}</div>
			<details key={current} className={styles.navigationPicker} ref={disclosure}
				onKeyDown={event => {
					if (event.key === 'Escape' && disclosure.current?.open) {
						event.preventDefault();
						close();
					}
				}}>
				<summary ref={summary}>Explore: {destinations.find(item => item.id === current)?.label ?? 'Sections'}</summary>
				<div className={styles.navigationOptions}>{links(true)}</div>
			</details>
		</nav>
	);
}
