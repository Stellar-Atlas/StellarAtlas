import Link from 'next/link';
import type { PublicNetwork } from '../../api/types';
import { formatDateTime } from '../../format/formatters';
import { NavLink } from './nav-link';
import { SearchBox } from './search-box';

interface AppShellProps {
	children: React.ReactNode;
	network: PublicNetwork;
}

export function AppShell({
	children,
	network
}: AppShellProps): React.JSX.Element {
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
					<SearchBox network={network} />
				</div>
			</header>
			<div className="network-strip">
				<div className="site-header-inner strip-inner">
					<span>{network.name}</span>
					<span>Ledger {network.latestLedger}</span>
					<strong>{formatDateTime(network.time)}</strong>
				</div>
			</div>
			{children}
		</>
	);
}
