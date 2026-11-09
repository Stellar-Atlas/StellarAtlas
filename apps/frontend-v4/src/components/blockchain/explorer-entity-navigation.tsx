'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { verifiedContractsPath } from '../../api/verified-contract-catalogue';
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
	const ref = useRef<HTMLElement>(null);
	useEffect(() => {
		const nav = ref.current;
		if (!nav) return;
		const revealActive = (): void => {
			const current = nav.querySelector<HTMLElement>('[aria-current="page"]');
			if (!current || nav.scrollWidth <= nav.clientWidth) return;
			const left = current.getBoundingClientRect().left - nav.getBoundingClientRect().left + nav.scrollLeft;
			if (left < nav.scrollLeft || left + current.offsetWidth > nav.scrollLeft + nav.clientWidth)
				nav.scrollTo({ left: Math.max(0, left - (nav.clientWidth - current.offsetWidth) / 2) });
		};
		revealActive();
		const observer = new ResizeObserver(revealActive);
		observer.observe(nav);
		return () => observer.disconnect();
	}, [active]);
	return (
		<nav ref={ref} className={styles.navigation} aria-label="Explore blockchain" tabIndex={0}>
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
			<Link
				href="/explorer/markets"
				aria-current={active === 'markets' ? 'page' : undefined}
			>
				Pair reports
			</Link>
			<Link
				href="/explorer/issuers"
				aria-current={active === 'issuers' ? 'page' : undefined}
			>
				Issuers
			</Link>
			<Link
				href="/explorer/contract-events"
				aria-current={active === 'contract-events' ? 'page' : undefined}
			>
				Contract events
			</Link>
			<Link
				href={verifiedContractsPath}
				prefetch={false}
				aria-current={active === 'verified-contracts' ? 'page' : undefined}
			>
				Verified contracts
			</Link>
		</nav>
	);
}
