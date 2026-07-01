import type { Metadata } from 'next';
import './globals.css';

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
			<body>{children}</body>
		</html>
	);
}
