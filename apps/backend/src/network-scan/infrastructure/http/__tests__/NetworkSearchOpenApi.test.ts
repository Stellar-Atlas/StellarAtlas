import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

interface OpenApiParameter {
	readonly name?: string;
}

interface OpenApiSchema {
	readonly enum?: readonly string[];
	readonly properties?: Record<string, OpenApiSchema>;
	readonly required?: readonly string[];
}

const document = openApiDocument as unknown as {
	readonly components: {
		readonly schemas: Record<string, OpenApiSchema>;
	};
	readonly paths: Record<
		string,
		{
			readonly get?: {
				readonly parameters?: readonly OpenApiParameter[];
			};
		}
	>;
};

describe('known-network search OpenAPI contract', () => {
	it.each(['/v1/search', '/v1/search/nodes', '/v1/search/organizations'])(
		'documents scope and offset for %s',
		(path) => {
			const names = document.paths[path]?.get?.parameters?.map(
				(parameter) => parameter.name
			);
			expect(names).toEqual(
				expect.arrayContaining(['limit', 'offset', 'scope'])
			);
		}
	);

	it.each(['/v1/known/nodes', '/v1/known/organizations'])(
		'documents bounded canonical pagination for %s',
		(path) => {
			const names = document.paths[path]?.get?.parameters?.map(
				(parameter) => parameter.name
			);
			expect(names).toEqual(
				expect.arrayContaining(['limit', 'offset', 'scope'])
			);
		}
	);

	it('documents source, freshness, record state, scope, and pagination', () => {
		expect(document.components.schemas.SearchHit?.required).toEqual(
			expect.arrayContaining([
				'freshness',
				'observedAt',
				'recordState',
				'scope',
				'source'
			])
		);
		expect(document.components.schemas.SearchResponse?.required).toEqual(
			expect.arrayContaining(['pagination', 'scope', 'source'])
		);
		expect(
			document.components.schemas.SearchReadModel?.properties?.schemaVersion
				?.enum
		).toEqual(['v3']);
	});
});
