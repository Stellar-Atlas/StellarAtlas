import type { Metadata } from 'next';
import { readDeveloperSignInReturn } from '@api/developer-verification';
import { verifiedContractsPath } from '@api/verified-contract-catalogue';
import styles from '@components/blockchain/explorer-entity.module.css';
import { PageHeading } from '@components/layout/page-heading';
import { DeveloperBuildCheck, DeveloperVerificationAccount } from '@components/verification/developer-verification';

export const metadata: Metadata = {
	title: 'Developer verification · StellarAtlas',
	referrer: 'no-referrer'
};

export default async function DeveloperVerificationPage({ searchParams }: {
	readonly searchParams: Promise<{ readonly signIn?: string | string[] }>;
}): Promise<React.JSX.Element> {
	const signIn = readDeveloperSignInReturn((await searchParams).signIn);
	return (
		<main className="shell">
			<PageHeading eyebrow="Developers" title="Contract build verification"
				description="Check the signed build evidence for a deployed Stellar contract." />
			<p><a href={verifiedContractsPath}>Browse verified contracts</a>
				{' · '}<a href="/docs/contract-verification">Publishing guide</a></p>
			<div className={styles.workspace}>
				<DeveloperBuildCheck />
				<DeveloperVerificationAccount signIn={signIn} />
			</div>
		</main>
	);
}
