import type { Metadata } from 'next';
import { GraphqlPlayground } from '../../../components/docs/graphql-playground';
import { PageHeading } from '../../../components/layout/page-heading';

export const metadata: Metadata = { title: 'GraphQL query runner | StellarAtlas' };

export default function GraphqlDocsPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading eyebrow="API" title="GraphQL query runner" description="Edit a query and its variables, send it to the public read-only GraphQL endpoint, and inspect the actual response." />
			<section className="panel docs-panel">
				<p><a href="/docs">REST API reference</a> · <a href="/api-docs?view=swagger#/Analytics/postAnalyticsGraphql">GraphQL HTTP contract</a></p>
				<GraphqlPlayground />
			</section>
		</main>
	);
}
