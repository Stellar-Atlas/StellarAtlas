import {
	fetchPublicOpenApiCatalog,
	publicOperationTryItUrl
} from '@api/public-openapi-catalog';
import { formatInteger } from '@format/formatters';

const openApiFetchOptions = {
	cache: 'no-store',
	timeoutMs: 10_000
} as const;

export async function PublicOpenApiReference(): Promise<React.JSX.Element> {
	const catalog = await fetchPublicOpenApiCatalog(openApiFetchOptions);

	return (
		<section className="generated-api-reference">
			<div className="generated-api-heading">
				<div>
					<h2>Complete generated route index</h2>
					<p>
						Generated from the backend OpenAPI document. Select a route to open
						its parameters, examples, and Try it out controls in Swagger.
					</p>
				</div>
				<strong>
					{formatInteger(catalog.operationCount)} operations across{' '}
					{formatInteger(catalog.pathCount)} paths
				</strong>
			</div>
			<div className="endpoint-grid">
				{catalog.groups.map((group) => (
					<section className="endpoint-group" key={group.tag}>
						<div>
							<h2>{group.tag}</h2>
							<p>{formatInteger(group.operations.length)} public operations</p>
						</div>
						<div className="endpoint-paths">
							{group.operations.map((operation) => (
								<div
									className="generated-endpoint"
									key={operation.method + ':' + operation.path}
								>
									<span
										className={
											'endpoint-method endpoint-method-' +
											operation.method.toLowerCase()
										}
									>
										{operation.method}
									</span>
									<div>
										<a href={publicOperationTryItUrl(operation, group.tag)}>
											<code>{operation.path}</code> — Try it
										</a>
										<small>{operation.summary}</small>
									</div>
								</div>
							))}
						</div>
					</section>
				))}
			</div>
		</section>
	);
}
