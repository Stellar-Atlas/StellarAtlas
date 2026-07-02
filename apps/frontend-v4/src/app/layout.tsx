import type { Metadata } from 'next';
import './globals.css';
import './shell.css';
import './components.css';
import './routes.css';
import './graph-explorer.css';
import './graph-interactions.css';
import './responsive.css';
import { AppShell } from '../components/layout/app-shell';

export const metadata: Metadata = {
	title: 'StellarAtlas',
	description: 'Stellar network explorer'
};

interface RootLayoutProps {
	children: React.ReactNode;
}

export default function RootLayout({
	children
}: RootLayoutProps): React.JSX.Element {
	return (
		<html lang="en">
			<body>
				<AppShell>{children}</AppShell>
			</body>
		</html>
	);
}
