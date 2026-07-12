import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

type Schema = {
	readonly allOf?: readonly { readonly $ref?: string }[];
	readonly deprecated?: boolean;
	readonly properties?: Readonly<Record<string, Schema>>;
	readonly required?: readonly string[];
	readonly enum?: readonly (boolean | string)[];
};

const document = openApiDocument as unknown as {
	readonly components: { readonly schemas: Readonly<Record<string, Schema>> };
	readonly paths: Readonly<
		Record<
			string,
			{
				readonly get?: {
					readonly responses: Readonly<
						Record<
							string,
							{
								readonly content?: Readonly<
									Record<string, { readonly schema?: Schema }>
								>;
							}
						>
					>;
				};
			}
		>
	>;
};

describe('data freshness OpenAPI contract', () => {
	it('labels the compatibility archive scan as historical legacy evidence', () => {
		const response =
			document.paths['/v1/status/data-freshness']?.get?.responses['200']
				?.content?.['application/json']?.schema;
		expect(response?.properties?.archiveScan).toMatchObject({
			allOf: [
				{
					$ref: '#/components/schemas/LegacyArchiveScanFreshnessProbeDTO'
				}
			],
			deprecated: true
		});

		const legacy =
			document.components.schemas.LegacyArchiveScanFreshnessProbeDTO;
		expect(legacy?.required).toEqual(
			expect.arrayContaining(['deprecated', 'historical', 'source'])
		);
		expect(legacy?.properties?.historical?.enum).toEqual([true]);
		expect(legacy?.properties?.source?.enum).toEqual(['legacy_range_scan']);
	});
});
