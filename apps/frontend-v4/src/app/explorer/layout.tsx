import { Suspense, type ReactNode } from 'react';
import { ExplorerInvestigation } from '@components/blockchain/explorer-investigation';
import styles from './explorer-layout.module.css';

export default function ExplorerLayout({
	children
}: {
	readonly children: ReactNode;
}): React.JSX.Element {
	return (
		<div className={styles.route}><Suspense fallback={children}>
			<ExplorerInvestigation>{children}</ExplorerInvestigation>
		</Suspense></div>
	);
}
