import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

describe('explorer local ledger OpenAPI schema', () => {
	it('documents canonical-only lookup and bounded range outcomes', () => {
		const range = openApiDocument.paths['/v1/explorer/local-ledgers'].get;
		const lookup =
			openApiDocument.paths['/v1/explorer/local-ledgers/{sequence}'].get;

		expect(range.description).toContain('at most 100');
		expect(range.description).toContain('never uses Horizon');
		expect(
			range.responses['200'].content['application/json'].schema.$ref
		).toEqual('#/components/schemas/ExplorerLocalLedgerRange');
		expect(
			range.responses['503'].content['application/json'].schema.$ref
		).toEqual('#/components/schemas/ExplorerLocalLedgerUnavailable');
		expect(
			lookup.responses['404'].content['application/json'].schema.$ref
		).toEqual('#/components/schemas/ExplorerLocalLedgerNotFound');
		expect(
			lookup.responses['503'].content['application/json'].schema.$ref
		).toEqual('#/components/schemas/ExplorerLocalLedgerUnavailable');
	});

	it('documents per-ledger proof, source object, and freshness fields', () => {
		const schemas = openApiDocument.components.schemas;
		const ledger = schemas.ExplorerCanonicalLedger;
		const evidence = schemas.ExplorerCanonicalLedgerEvidence;
		const freshness = schemas.ExplorerCanonicalLedgerFreshness;

		expect(ledger.required).toEqual(
			expect.arrayContaining(['closedAt', 'evidence', 'freshness', 'source'])
		);
		expect(evidence.required).toEqual(
			expect.arrayContaining([
				'archiveSource',
				'batchId',
				'checkpointProofId',
				'proofVersion',
				'sourceObject'
			])
		);
		expect(evidence.properties.sourceObject).toEqual({
			$ref: '#/components/schemas/CanonicalXdrSourceObjectEvidence'
		});
		expect(freshness.required).toEqual(['ingestedAt', 'proofEvaluatedAt']);
		expect(
			schemas.ExplorerLocalLedgerUnavailable.properties.reason.enum
		).toEqual(['canonical_coverage_empty', 'outside_canonical_coverage']);
	});
});
