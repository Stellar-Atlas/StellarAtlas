import type { Metadata } from 'next';
import './globals.css';
import './shell.css';
import './components.css';
import './archive-evidence.css';
import './organization-toml-evidence.css';
import './known-archive-evidence.css';
import './routes.css';
import './graph-explorer.css';
import './graph-live-feed.css';
import './graph-detail-panels.css';
import './graph-interactions.css';
import './blockchain-explorer.css';
import './explorer-operation-table.css';
import './status.css';
import './responsive.css';
import { AppShell } from '../components/layout/app-shell';

export const metadata: Metadata = {
	title: 'StellarAtlas',
	description: 'Stellar network explorer'
};

const themeBootstrapScript = `
(() => {
	try {
		const stored = window.localStorage.getItem('stellaratlas-theme');
		const prefersLight =
			stored === 'system' &&
			window.matchMedia('(prefers-color-scheme: light)').matches;
		const theme = stored === 'light' || prefersLight ? 'light' : 'dark';
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
	} catch {
		document.documentElement.dataset.theme = 'dark';
		document.documentElement.style.colorScheme = 'dark';
	}
})();
`;

interface RootLayoutProps {
	children: React.ReactNode;
}

export default function RootLayout({
	children
}: RootLayoutProps): React.JSX.Element {
	return (
		<html data-theme="dark" lang="en" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
			</head>
			<body>
				<AppShell>{children}</AppShell>
			</body>
		</html>
	);
}
