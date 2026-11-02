'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { prewarmArchiveInventorySnapshot } from '../../api/archive-inventory-client';

interface NavLinkProps {
	href: string;
	label: string;
}

export function NavLink({ href, label }: NavLinkProps): React.JSX.Element {
	const pathname = usePathname();
	const isActive = href === '/' ? pathname === href : pathname.startsWith(href);
	const prewarm = href === '/archives'
		? prewarmArchiveInventorySnapshot
		: undefined;

	return (
		<Link
			className={isActive ? 'nav-link active' : 'nav-link'}
			href={href}
			onFocus={prewarm}
			onPointerEnter={prewarm}
		>
			{label}
		</Link>
	);
}
