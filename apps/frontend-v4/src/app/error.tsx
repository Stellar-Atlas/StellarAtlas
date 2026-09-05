'use client';

import { useEffect } from 'react';
import { RouteErrorPanel } from '@components/layout/route-fallbacks';

interface ErrorPageProps {
	error: Error & { digest?: string };
	retry: () => void;
}

export default function ErrorPage({
	error,
	retry
}: ErrorPageProps): React.JSX.Element {
	useEffect(() => {
		console.error('Page render failed', error);
	}, [error]);
	const deploymentMismatch = /441|Server Action|unexpected response/i.test(
		error.message
	);
	return (
		<RouteErrorPanel
			eyebrow="StellarAtlas"
			title="This page could not be loaded"
			message={
				deploymentMismatch
					? 'The page could not finish loading. Reload to obtain the latest application version. This is not an archive verification failure.'
					: 'This page is temporarily unavailable. Retry to fetch it again; archive verification results have not been changed.'
			}
			onRetry={deploymentMismatch ? () => window.location.reload() : retry}
		/>
	);
}
