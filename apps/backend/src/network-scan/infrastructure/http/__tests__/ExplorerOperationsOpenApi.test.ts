import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

describe('explorer operation OpenAPI schema', () => {
	it('documents transaction result XDR outcomes and coverage', () => {
		const schemas = openApiDocument.components.schemas;
		const operation = schemas.ExplorerOperation.properties;
		const operations = schemas.ExplorerOperations.properties;

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
			expect.arrayContaining(['outcomeIndexedBatches', 'outcomesComplete'])
		);
	});
});
