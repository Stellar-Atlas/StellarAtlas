import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
	DocsBody,
	DocsDescription,
	DocsPage,
	DocsTitle
} from 'fumadocs-ui/layouts/docs/page';
import {
	developerGuidePages,
	getDeveloperGuidePage
} from '../../../components/docs/developer-guide-content';

interface Props {
	params: Promise<{ slug: string }>;
}
export function generateStaticParams(): { slug: string }[] {
	return developerGuidePages.map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
	const page = getDeveloperGuidePage((await params).slug);
	return {
		title: page
			? page.title + ' | StellarAtlas Developers'
			: 'Documentation not found',
		description: page?.description
	};
}
export default async function GuidePage({
	params
}: Props): Promise<React.JSX.Element> {
	const page = getDeveloperGuidePage((await params).slug);
	if (!page) notFound();
	const toc = page.sections.map((section) => ({
		title: section.title,
		url: '#' + section.id,
		depth: 2
	}));
	return (
		<DocsPage toc={toc}>
			<DocsTitle>{page.title}</DocsTitle>
			<DocsDescription>{page.description}</DocsDescription>
			<DocsBody>
				{page.sections.map((section) => (
					<section
						className="developer-guide-section"
						id={section.id}
						key={section.id}
					>
						<h2>{section.title}</h2>
						{section.content}
					</section>
				))}
			</DocsBody>
		</DocsPage>
	);
}
