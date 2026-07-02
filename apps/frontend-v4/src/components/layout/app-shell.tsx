import Link from 'next/link';
import { NetworkStrip } from './network-strip';
import { NavLink } from './nav-link';
import { SearchBox } from './search-box';

interface AppShellProps {
	children: React.ReactNode;
}

export function AppShell({ children }: AppShellProps): React.JSX.Element {
	return (
		<>
			<header className="site-header">
				<div className="site-header-inner">
					<Link className="brand" href="/">
						<span className="brand-mark">SA</span>
						<span>StellarAtlas</span>
					</Link>
					<nav className="nav">
						<NavLink href="/" label="Graph" />
						<NavLink href="/overview" label="Overview" />
						<NavLink href="/nodes" label="Nodes" />
						<NavLink href="/organizations" label="Organizations" />
						<NavLink href="/docs" label="API" />
					</nav>
					<SearchBox />
				</div>
			</header>
			<NetworkStrip />
			{children}
		</>
	);
}
