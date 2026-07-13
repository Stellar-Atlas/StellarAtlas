import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

describe('explorer operation OpenAPI schema', () => {
	it('documents transaction result XDR outcomes and coverage', () => {
		const schemas = openApiDocument.components.schemas;
		const operation = schemas.ExplorerOperation.properties;
		const operations = schemas.ExplorerOperations.properties;
		const path = openApiDocument.paths['/v1/explorer/operations'].get;
		const accountParameter = path.parameters.find(
			(parameter) => parameter.name === 'accountId'
		);

		expect(accountParameter?.description).toContain(
			'G matches the base key of G and M references'
		);
		expect(accountParameter?.description).toContain(
			'M matches the exact muxed identity'
		);
		expect(operation.accountReferences.items).toEqual({
			$ref: '#/components/schemas/ExplorerOperationAccountReference'
		});
		expect(
			schemas.ExplorerOperationAccountReference.properties.role.enum
		).toEqual([
			'claimant',
			'clawback_source',
			'destination',
			'effective_source',
			'inflation_destination',
			'offer_seller',
			'sponsored_account',
			'sponsorship_account',
			'trustor'
		]);

		expect(operation.outcome).toMatchObject({
			enum: ['failed', 'not_applied', 'succeeded'],
			nullable: true
		});
		expect(operation.outcomeEvidence.properties.factScope.enum).toEqual([
			'transaction_result_xdr'
		]);
		expect(operations.factBoundary.properties.outcomes.enum).toEqual([
			'transaction_result_xdr_when_indexed'
		]);
		expect(operations.coverage.required).toEqual(
			expect.arrayContaining([
				'accountReferenceIndexedBatches',
				'accountReferencesComplete',
				'operationFactsComplete',
				'outcomeIndexedBatches',
				'outcomesComplete'
			])
		);
		expect(operations.factBoundary.properties).toMatchObject({
			excludes: {
				enum: ['state_effects_soroban_auth_signers_and_asset_issuers']
			},
			includes: {
				enum: [
					'operation_type_effective_source_and_explicit_envelope_account_references'
				]
			}
		});
	});
});
