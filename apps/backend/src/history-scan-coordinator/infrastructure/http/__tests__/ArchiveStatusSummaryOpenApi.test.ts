import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

type Schema = {
	readonly maxItems?: number;
	readonly properties?: Record<string, Schema>;
	readonly required?: readonly string[];
	readonly $ref?: string;
};

const document = openApiDocument as unknown as {
	readonly components: { readonly schemas: Record<string, Schema> };
	readonly paths: Record<
		string,
		{
			readonly get?: {
				readonly description?: string;
				readonly responses: Record<
					string,
					{
						readonly content?: Record<string, { readonly schema?: Schema }>;
					}
				>;
			};
		}
	>;
};

describe('archive status summary OpenAPI contract', () => {
	it('separates the bounded headline from legacy grouped object coverage', () => {
		expect(
			document.paths['/v1/archive-scans/objects/status-summary']?.get
				?.responses['200']?.content?.['application/json']?.schema?.$ref
		).toBe('#/components/schemas/HistoryArchiveStatusSummaryV1');
		expect(
			document.paths['/v1/archive-scans/objects/summary']?.get?.responses['200']
				?.content?.['application/json']?.schema?.$ref
		).toBe('#/components/schemas/HistoryArchiveObjectSummaryV1');
		expect(
			document.paths['/v1/archive-scans/objects/summary']?.get?.description
		).toContain('Object totals retain queue-object semantics');
	});

	it('requires truthful bounded source fields in both contracts', () => {
		expect(
			document.components.schemas.HistoryArchiveStatusSummaryV1?.required
		).toEqual(
			expect.arrayContaining([
				'activeObjectChecks',
				'checkpointCoverage',
				'sourceCount',
				'sources',
				'sourcesTruncated'
			])
		);
		expect(
			document.components.schemas.HistoryArchiveStatusSummaryV1?.properties
				?.sources?.maxItems
		).toBe(256);
		expect(
			document.components.schemas.HistoryArchiveObjectSummaryV1?.required
		).toContain('sources');
		expect(
			document.components.schemas.HistoryArchiveObjectSummaryV1?.properties
				?.sources
		).toBeDefined();
	});
});
