'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { NavLink } from './nav-link';
import { SearchBox } from './search-box';
import { ThemeToggle } from './theme-toggle';

const navigationItems = [
	{ href: '/', label: 'Graph' },
	{ href: '/explorer', label: 'Explorer' },
	{ href: '/overview', label: 'Overview' },
	{ href: '/nodes', label: 'Nodes' },
	{ href: '/organizations', label: 'Organizations' },
	{ href: '/status', label: 'Status' },
	{ href: '/archives', label: 'Archives' },
	{ href: '/docs', label: 'API' }
] as const;

export function PrimaryNavigation(): React.JSX.Element {
	const pathname = usePathname();
	const [openForPath, setOpenForPath] = useState<string | null>(null);
	const isOpen = openForPath === pathname;
	const close = (): void => setOpenForPath(null);

	return (
		<>
			<button
				aria-controls="primary-navigation"
				aria-expanded={isOpen}
				className="nav-toggle"
				onClick={() => setOpenForPath(isOpen ? null : pathname)}
				type="button"
			>
				<span>{isOpen ? 'Close' : 'Menu'}</span>
			</button>
			<nav
				aria-label="Primary navigation"
				className={isOpen ? 'nav is-open' : 'nav'}
				id="primary-navigation"
				onClick={(event) => {
					if (event.target instanceof Element && event.target.closest('a')) {
						close();
					}
				}}
			>
				{navigationItems.map((item) => (
					<NavLink href={item.href} key={item.href} label={item.label} />
				))}
			</nav>
			<div className={isOpen ? 'header-tools is-open' : 'header-tools'}>
				<SearchBox />
				<ThemeToggle />
			</div>
		</>
	);
}
