import Link from 'next/link';
import { NetworkStrip } from './network-strip';
import { PrimaryNavigation } from './primary-navigation';

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
					<PrimaryNavigation />
				</div>
			</header>
			<NetworkStrip />
			{children}
		</>
	);
}
