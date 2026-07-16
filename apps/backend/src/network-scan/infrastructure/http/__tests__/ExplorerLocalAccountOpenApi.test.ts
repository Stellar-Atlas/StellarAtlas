import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

describe('explorer local account observation OpenAPI schema', () => {
	it('documents bounded historical observations and all three evidence statuses', () => {
		const route =
			openApiDocument.paths['/v1/explorer/local-accounts/{accountId}/changes']
				.get;
		const limit = route.parameters.find(
			(parameter) => parameter.name === 'limit'
		);

		expect(route.description).toContain('not current account state');
		expect(route.description).toContain(
			'not proof that the account does not exist'
		);
		expect(limit?.schema).toMatchObject({
			default: 1,
			maximum: 25,
			minimum: 1
		});
		expect(
			route.responses['200'].content['application/json'].schema.oneOf
		).toEqual([
			{
				$ref: '#/components/schemas/ExplorerLocalAccountChangesAvailable'
			},
			{
				$ref: '#/components/schemas/ExplorerLocalAccountChangesNotObserved'
			}
		]);
		expect(route.responses['503'].content['application/json'].schema.$ref).toBe(
			'#/components/schemas/ExplorerLocalAccountChangesUnavailable'
		);
	});

	it('requires typed account, deletion, position, coverage, freshness, and provenance', () => {
		const schemas = openApiDocument.components.schemas;
		const observation = schemas.ExplorerLocalAccountChange;
		const provenance = schemas.ExplorerLocalAccountChangeProvenance;

		expect(observation.required).toEqual(
			expect.arrayContaining([
				'accountFields',
				'change',
				'coverage',
				'deleted',
				'freshness',
				'position',
				'provenance'
			])
		);
		expect(provenance.required).toEqual([
			'batch',
			'dataset',
			'manifest',
			'proof',
			'row'
		]);
		expect(provenance.properties.proof.properties.minimumVersion.minimum).toBe(
			6
		);
		expect(
			schemas.ExplorerLocalAccountChangesNotObserved.allOf[1].properties.status
				.enum
		).toEqual(['not_observed']);
		expect(
			schemas.ExplorerLocalAccountChangesUnavailable.allOf[1].properties.status
				.enum
		).toEqual(['unavailable']);
	});

	it('does not expose a raw state entry XDR field', () => {
		const contract = JSON.stringify({
			account: openApiDocument.components.schemas.ExplorerLocalAccountChange,
			accountFields:
				openApiDocument.components.schemas.ExplorerLocalAccountFields,
			provenance:
				openApiDocument.components.schemas.ExplorerLocalAccountChangeProvenance
		});

		expect(contract).not.toMatch(/state.?entry.?xdr/i);
	});
});
