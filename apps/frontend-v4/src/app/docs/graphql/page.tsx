import type { Metadata } from 'next';
import {
	DocsDescription,
	DocsPage,
	DocsTitle
} from 'fumadocs-ui/layouts/docs/page';
import { GraphqlPlayground } from '../../../components/docs/graphql-playground';

export const metadata: Metadata = {
	title: 'GraphQL explorer | StellarAtlas Developers',
	description:
		'Explore the live GraphQL schema, validate typed queries and inspect responses.'
};
export default function GraphqlDocsPage(): React.JSX.Element {
	return (
		<DocsPage
			full
			toc={[]}
			tableOfContent={{ enabled: false }}
			tableOfContentPopover={{ enabled: false }}
		>
			<DocsTitle>Interactive GraphQL</DocsTitle>
			<DocsDescription>
				Schema-aware queries for parsed Stellar data. Open the documentation
				explorer inside the editor to inspect fields and arguments.
			</DocsDescription>
			<GraphqlPlayground />
		</DocsPage>
	);
}
