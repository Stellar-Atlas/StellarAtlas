import type { Metadata } from 'next';
import Link from 'next/link';
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle
} from 'fumadocs-ui/layouts/docs/page';
import { getDocsOperations } from '../../components/docs/docs-catalog';
import { DocsApiDirectory } from '../../components/docs/docs-api-directory';

export const metadata: Metadata = {
	title: 'Developer documentation | StellarAtlas',
	description:
		'Explore Stellar API resources, request examples, schemas, and dataset coverage.'
};

export default async function DocsPageIndex(): Promise<React.JSX.Element> {
	return (
		<DocsPage
			full
			toc={[]}
			tableOfContent={{ enabled: false }}
			tableOfContentPopover={{ enabled: false }}
		>
			<DocsTitle>StellarAtlas API documentation</DocsTitle>
			<DocsDescription>
				Find a resource, inspect its schema, and run a request. The complete
				public endpoint directory is below.
			</DocsDescription>
			<DocsBody>
				<nav className="developer-docs-start" aria-label="Start with the API">
					<Link href="/docs/quickstart" prefetch={false}>
						<strong>Make your first request</strong>
						<span>REST examples and pagination →</span>
					</Link>
					<Link href="/docs/contract-events" prefetch={false}>
						<strong>Explore contract events</strong>
						<span>Decoded payloads and transaction context →</span>
					</Link>
					<Link href="/docs/graphql" prefetch={false}>
						<strong>Run a GraphQL query</strong>
						<span>Schema explorer and editable examples →</span>
					</Link>
				</nav>
				<p className="developer-docs-coverage-note">
					Before interpreting results, check{' '}
					<Link href="/docs/datasets">dataset coverage</Link>. Imported history
					is not necessarily current-chain state.{' '}
					<Link href="/docs/services">Horizon, RPC and archive downloads</Link>{' '}
					have separate coverage.
				</p>
				<h2 id="resources">Browse all API resources</h2>
				<p>
					These sections mirror the navigation and are generated from the public
					OpenAPI specification. Select an endpoint to see parameters, response
					fields, and its request tester.
				</p>
			</DocsBody>
			<DocsApiDirectory operations={await getDocsOperations()} collapsible />
		</DocsPage>
	);
}
