import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

interface OpenApiSchema {
	readonly allOf?: readonly OpenApiSchema[];
	readonly items?: OpenApiSchema;
	readonly nullable?: boolean;
	readonly properties?: Record<string, OpenApiSchema>;
	readonly required?: readonly string[];
	readonly $ref?: string;
}

const document = openApiDocument as unknown as {
	readonly components: {
		readonly schemas: Record<string, OpenApiSchema>;
	};
	readonly paths: Record<
		string,
		{
			readonly get?: {
				readonly responses: Record<
					string,
					{
						readonly content?: Record<
							string,
							{ readonly schema?: OpenApiSchema }
						>;
					}
				>;
			};
		}
	>;
};

describe('organization TOML OpenAPI contract', () => {
	it('documents additive evidence without making it part of V1 required fields', () => {
		const organization = document.components.schemas.OrganizationV1;
		const additions = organization?.allOf?.[1];

		expect(additions?.properties).toMatchObject({
			stellarToml: {
				$ref: '#/components/schemas/OrganizationStellarTomlV1'
			},
			tomlLatestAttempt: {
				$ref: '#/components/schemas/OrganizationTomlAttemptV1'
			},
			tomlLatestFailure: {
				$ref: '#/components/schemas/OrganizationTomlFailureV1'
			},
			tomlLatestInsecureAttempt: {
				$ref: '#/components/schemas/OrganizationTomlAttemptV1'
			}
		});
		expect(additions?.required).toBeUndefined();
		expect(
			document.components.schemas.OrganizationStellarTomlV1?.required
		).toEqual(['content', 'url']);
		expect(
			document.components.schemas.OrganizationTomlFailureV1?.nullable
		).toBe(true);
	});

	it('uses the composed organization schema on V1 and known endpoints', () => {
		expect(
			document.paths['/v1/organizations']?.get?.responses['200']?.content?.[
				'application/json'
			]?.schema?.items?.$ref
		).toBe('#/components/schemas/OrganizationV1');
		expect(
			document.components.schemas.KnownOrganization?.properties?.organization
				?.$ref
		).toBe('#/components/schemas/OrganizationV1');
	});
});
