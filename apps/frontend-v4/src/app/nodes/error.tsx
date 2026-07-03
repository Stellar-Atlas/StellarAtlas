'use client';

import { RouteErrorPanel } from '@components/layout/route-fallbacks';

interface NodesErrorPageProps {
	error: Error & { digest?: string };
	reset: () => void;
}

export default function NodesErrorPage({
	error,
	reset
}: NodesErrorPageProps): React.JSX.Element {
	return (
		<RouteErrorPanel
			eyebrow="Nodes"
			message={error.message}
			onRetry={reset}
			title="Node data unavailable"
		/>
	);
}
