'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavLinkProps {
	href: string;
	label: string;
}

export function NavLink({ href, label }: NavLinkProps): React.JSX.Element {
	const pathname = usePathname();
	const isActive = href === '/' ? pathname === href : pathname.startsWith(href);

	return (
		<Link className={isActive ? 'nav-link active' : 'nav-link'} href={href}>
			{label}
		</Link>
	);
}
