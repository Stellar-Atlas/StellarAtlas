import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

type Schema = {
	readonly allOf?: readonly { readonly $ref?: string }[];
	readonly description?: string;
	readonly format?: string;
	readonly items?: { readonly $ref?: string };
	readonly maxItems?: number;
	readonly properties?: Readonly<Record<string, Schema>>;
	readonly required?: readonly string[];
	readonly $ref?: string;
};

type Response = {
	readonly content?: Readonly<Record<string, { readonly schema?: Schema }>>;
};

const document = openApiDocument as unknown as {
	readonly components: {
		readonly schemas: Readonly<Record<string, Schema>>;
	};
	readonly paths: Readonly<
		Record<
			string,
			{
				readonly get?: {
					readonly description?: string;
					readonly responses: Readonly<Record<string, Response>>;
				};
			}
		>
	>;
};

describe('archive repair OpenAPI contract', () => {
	it('documents local artifact availability separately from remote source evidence', () => {
		const operation =
			document.paths['/v1/archive-scans/{encodedUrl}/repair-plan']?.get;
		expect(
			operation?.responses['200']?.content?.['application/json']?.schema?.$ref
		).toBe('#/components/schemas/HistoryArchiveRepairPlanV1');
		expect(operation?.description).toContain(
			'knownGoodSources are attributed remote archive URLs only'
		);

		const action = document.components.schemas.HistoryArchiveRepairActionV1;
		expect(action?.required).toEqual(
			expect.arrayContaining(['knownGoodSources', 'repairArtifact'])
		);
		expect(action?.properties?.knownGoodSources?.maxItems).toBe(5);
		expect(action?.properties?.repairArtifact?.allOf?.[0]?.$ref).toBe(
			'#/components/schemas/HistoryArchiveRepairArtifactAvailabilityV1'
		);
		expect(
			document.components.schemas.HistoryArchiveRepairSourceCandidateV1
				?.description
		).toContain('never a StellarAtlas-hosted repair artifact');
	});

	it('documents a bounded binary endpoint and structured unavailable responses', () => {
		const operation =
			document.paths['/v1/archive-scans/repair-artifacts/buckets/{bucketHash}']
				?.get;
		expect(
			operation?.responses['200']?.content?.['application/gzip']?.schema
		).toMatchObject({ format: 'binary' });
		for (const status of ['400', '404', '409', '413', '429', '503']) {
			expect(
				operation?.responses[status]?.content?.['application/json']?.schema
					?.$ref
			).toBe('#/components/schemas/HistoryArchiveRepairArtifactUnavailableV1');
		}

		expect(
			document.components.schemas.HistoryArchiveRepairPlanV1?.properties
				?.actions?.maxItems
		).toBe(500);
		expect(
			document.components.schemas.HistoryArchiveRepairArtifactAvailableV1
				?.required
		).toEqual(
			expect.arrayContaining([
				'contentHash',
				'downloadUrl',
				'objectIdentity',
				'provenAt'
			])
		);
	});
});
