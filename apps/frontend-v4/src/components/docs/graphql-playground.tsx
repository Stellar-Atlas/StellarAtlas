'use client';

import dynamic from 'next/dynamic';

const GraphqlIde = dynamic(() => import('./graphql-ide'), {
	ssr: false,
	loading: () => <p role="status">Loading GraphQL editor…</p>
});

export function GraphqlPlayground(): React.JSX.Element {
	return <GraphqlIde />;
}
