import {
	DocsPage,
	DocsTitle,
	DocsDescription
} from 'fumadocs-ui/layouts/docs/page';
import { getDocsOperations } from '../../../components/docs/docs-catalog';
import { DocsApiDirectory } from '../../../components/docs/docs-api-directory';
export const metadata = { title: 'REST API reference | StellarAtlas' };
export default async function ApiReferencePage() {
	return (
		<DocsPage full toc={[]} tableOfContent={{ enabled: false }}>
			<DocsTitle>REST API reference</DocsTitle>
			<DocsDescription>
				Choose a resource to inspect its parameters, response schema, and
				runnable request. Every endpoint below comes from the application's
				public OpenAPI specification.
			</DocsDescription>
			<DocsApiDirectory operations={await getDocsOperations()} />
		</DocsPage>
	);
}
