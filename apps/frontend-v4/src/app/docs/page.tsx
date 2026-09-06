import type { Metadata } from 'next';
import { PublicOpenApiReference } from '../../components/docs/public-openapi-reference';
import styles from '../../components/docs/api-reference.module.css';

export const metadata: Metadata = {
	title: 'API reference | StellarAtlas',
	description: 'Explore the public OpenAPI specification, schemas, examples, and send real API requests.'
};

export default function DocsPage(): React.JSX.Element {
	return (
		<main className={styles.page}>
			<header className={styles.heading}>
				<div>
					<h1>API reference</h1>
					<p>Search an operation, inspect its schema, and select Try it out and Execute to call the public API.</p>
				</div>
				<nav aria-label="Documentation tools" className={styles.links}>
					<a href="/docs/graphql">GraphQL query runner</a>
					<a href="/api-docs?view=swagger">Swagger UI</a>
					<a href="/api-docs/openapi.json">OpenAPI JSON</a>
				</nav>
			</header>
			<PublicOpenApiReference />
		</main>
	);
}
