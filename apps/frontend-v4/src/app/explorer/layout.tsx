import { Suspense, type ReactNode } from 'react';
import { ExplorerInvestigation } from '@components/blockchain/explorer-investigation';

export default function ExplorerLayout({
	children
}: {
	readonly children: ReactNode;
}): React.JSX.Element {
	return (
		<Suspense fallback={children}>
			<ExplorerInvestigation>{children}</ExplorerInvestigation>
		</Suspense>
	);
}
