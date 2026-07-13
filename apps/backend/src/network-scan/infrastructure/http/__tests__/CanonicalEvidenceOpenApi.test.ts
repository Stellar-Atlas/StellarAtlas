import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

describe('canonical evidence OpenAPI schema', () => {
	it.each([
		'ExplorerCanonicalCoverage',
		'CanonicalFullHistoryCoverage'
	] as const)('documents exact latest-batch evidence for %s', (schemaName) => {
		const schema = openApiDocument.components.schemas[schemaName];
		expect(schema.required).toEqual(
			expect.arrayContaining(['latestEvidence', 'source'])
		);
		expect(schema.properties.latestEvidence).toEqual({
			$ref: '#/components/schemas/CanonicalLatestEvidence'
		});
	});

	it('documents digest algorithm and byte representation', () => {
		const schemas = openApiDocument.components.schemas;
		expect(schemas.CanonicalJsonSourceObjectEvidence.properties).toMatchObject({
			algorithm: { enum: ['sha256'] },
			contentDigest: { pattern: '^[0-9a-f]{64}$' },
			representation: { enum: ['canonical-json'] }
		});
		expect(schemas.CanonicalXdrSourceObjectEvidence.properties).toMatchObject({
			algorithm: { enum: ['sha256'] },
			representation: { enum: ['uncompressed-xdr'] }
		});
	});
});
