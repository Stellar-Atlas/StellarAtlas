'use client';

import { RouteErrorPanel } from '@components/layout/route-fallbacks';

interface OrganizationsErrorPageProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function OrganizationsErrorPage({
	error,
	reset
}: OrganizationsErrorPageProps): React.JSX.Element {
	return (
		<RouteErrorPanel
			eyebrow="Organizations"
			message={error.message}
			onRetry={reset}
			title="Organization data unavailable"
		/>
	);
}
