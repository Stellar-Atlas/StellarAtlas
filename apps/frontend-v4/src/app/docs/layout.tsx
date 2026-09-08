import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import '../../../generated/fumadocs.css';
import {
	getDocsTree,
	getDocsOperations
} from '../../components/docs/docs-catalog';
import { collectDocsSearchItems } from '../../components/docs/docs-search-model';
import { DeveloperDocsProvider } from '../../components/docs/developer-docs-provider';

export default async function DeveloperLayout({
	children
}: {
	children: ReactNode;
}): Promise<React.JSX.Element> {
	const tree = await getDocsTree();
	return (
		<DeveloperDocsProvider
			searchItems={collectDocsSearchItems(tree, await getDocsOperations())}
		>
			<DocsLayout
				tree={tree}
				nav={{ title: 'StellarAtlas Developers', url: '/docs' }}
				themeSwitch={{ enabled: false }}
				sidebar={{ prefetch: false, defaultOpenLevel: 1 }}
				links={[
					{ text: 'Explorer', url: '/explorer' },
					{ text: 'Network status', url: '/status' }
				]}
			>
				{children}
			</DocsLayout>
		</DeveloperDocsProvider>
	);
}
