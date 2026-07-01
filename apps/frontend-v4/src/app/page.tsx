import { NetworkOverview } from '../components/network-overview';
import { ApiClientError, fetchPublicNetwork } from '../api/client';

export const dynamic = 'force-dynamic';

const getErrorMessage = (error: Error): string => {
	if (error instanceof ApiClientError && error.statusCode) {
		return `${error.message}. Check the backend service for that status.`;
	}

	return error.message;
};

export default async function Home(): Promise<React.JSX.Element> {
	try {
		const network = await fetchPublicNetwork();

		return <NetworkOverview network={network} />;
	} catch (error) {
		const typedError = error instanceof Error
			? error
			: new Error('Network API request failed');

		return (
			<main className="shell">
				<section className="error-panel">
					<p className="eyebrow">StellarAtlas</p>
					<h1>Network API unavailable</h1>
					<p>{getErrorMessage(typedError)}</p>
					<code>STELLAR_ATLAS_PUBLIC_API_URL</code>
				</section>
			</main>
		);
	}
}
