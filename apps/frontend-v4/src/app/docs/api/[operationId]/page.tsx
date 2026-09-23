import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getDocsOperations } from '../../../../components/docs/docs-catalog';
import { getDocsOperationProps } from '../../../../components/docs/docs-openapi';
import { DocsOpenApiPage } from '../../../../components/docs/docs-openapi-page';

type Props = { params: Promise<{ operationId: string }> };
export async function generateStaticParams() {
	return (await getDocsOperations()).map(({ id }) => ({ operationId: id }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const { operationId } = await params;
	const operation = (await getDocsOperations()).find(
		(item) => item.id === operationId
	);
	return { title: (operation?.title ?? 'API reference') + ' | StellarAtlas' };
}
export default async function OperationPage({ params }: Props) {
	const { operationId } = await params;
	const operation = (await getDocsOperations()).find(
		(item) => item.id === operationId
	);
	if (!operation) notFound();
	return (
		<DocsPage full toc={[]} tableOfContent={{ enabled: false }}>
			<DocsTitle>{operation.title}</DocsTitle>
			<DocsOpenApiPage {...await getDocsOperationProps(operation)} />
		</DocsPage>
	);
}
