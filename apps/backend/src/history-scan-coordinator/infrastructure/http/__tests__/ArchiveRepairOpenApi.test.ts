import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

type Schema = {
	readonly additionalProperties?: boolean;
	readonly allOf?: readonly { readonly $ref?: string }[];
	readonly description?: string;
	readonly enum?: readonly string[];
	readonly format?: string;
	readonly items?: { readonly $ref?: string };
	readonly maxItems?: number;
	readonly minimum?: number;
	readonly nullable?: boolean;
	readonly oneOf?: readonly { readonly $ref?: string }[];
	readonly pattern?: string;
	readonly properties?: Readonly<Record<string, Schema>>;
	readonly required?: readonly string[];
	readonly type?: string;
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
			'A remote URL is only a retrieval location'
		);
		expect(operation?.description).toContain('status=verify-on-download');

		const action = document.components.schemas.HistoryArchiveRepairActionV1;
		expect(action?.required).toEqual(
			expect.arrayContaining(['knownGoodSources', 'repairArtifact'])
		);
		expect(action?.properties?.knownGoodSources?.maxItems).toBe(5);
		expect(action?.properties?.repairArtifact?.allOf?.[0]?.$ref).toBe(
			'#/components/schemas/HistoryArchiveRepairArtifactAvailabilityV1'
		);
		const candidate =
			document.components.schemas.HistoryArchiveRepairSourceCandidateV1;
		expect(candidate?.description).toContain(
			'retrieval locations, never proof'
		);
		expect(candidate?.additionalProperties).toBe(false);
		expect(candidate?.required).toEqual(
			expect.arrayContaining([
				'archiveUrlIdentity',
				'objectUrl',
				'proof',
				'verifiedAt'
			])
		);
		expect(candidate?.properties?.archiveUrlIdentity?.description).toContain(
			'identity of the source archive'
		);
		expect(candidate?.properties?.objectUrl?.description).toContain(
			'retrieval location'
		);
		expect(candidate?.properties?.objectUrl?.description).toContain(
			'never proof'
		);
		expect(candidate?.properties?.verifiedAt).toMatchObject({
			format: 'date-time',
			nullable: true,
			type: 'string'
		});
		expect(candidate?.properties?.proof?.$ref).toBe(
			'#/components/schemas/HistoryArchiveRepairSourceProofV1'
		);
	});

	it('requires checkpoint-bound proof provenance for every source candidate', () => {
		const proof = document.components.schemas.HistoryArchiveRepairSourceProofV1;
		expect(proof?.additionalProperties).toBe(false);
		expect(proof?.required).toEqual(
			expect.arrayContaining([
				'anchor',
				'candidateObjectRemoteId',
				'checkpointLedger',
				'contentHash',
				'evaluatedAt',
				'kind',
				'proofId',
				'proofVersion'
			])
		);
		expect(proof?.properties?.evaluatedAt).toMatchObject({
			format: 'date-time',
			type: 'string'
		});
		expect(proof?.properties?.proofVersion?.minimum).toBe(1);

		const contentHash = proof?.properties?.contentHash;
		expect(contentHash?.required).toEqual(
			expect.arrayContaining(['algorithm', 'digest', 'representation'])
		);
		expect(contentHash?.properties?.digest?.pattern).toBe('^[0-9a-f]{64}$');
		expect(contentHash?.properties?.representation?.enum).toEqual([
			'canonical-json',
			'uncompressed-xdr'
		]);

		const anchor = proof?.properties?.anchor;
		expect(anchor?.required).toEqual(['kind', 'sourceCount']);
		expect(anchor?.properties?.kind?.enum).toEqual([
			'content-addressed-bucket',
			'multi-source',
			'target-digest'
		]);
		expect(anchor?.properties?.sourceCount?.minimum).toBe(1);
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

	it('documents proof-bound verify-on-download artifacts and downloads', () => {
		const availability =
			document.components.schemas.HistoryArchiveRepairArtifactAvailabilityV1;
		expect(availability?.oneOf).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					$ref: '#/components/schemas/HistoryArchiveRepairArtifactVerifyOnDownloadV1'
				})
			])
		);
		const artifact =
			document.components.schemas
				.HistoryArchiveRepairArtifactVerifyOnDownloadV1;
		expect(artifact?.required).toEqual(
			expect.arrayContaining([
				'contentHash',
				'downloadUrl',
				'objectIdentity',
				'provenAt',
				'status'
			])
		);
		expect(artifact?.properties?.status?.enum).toEqual(['verify-on-download']);

		const operation =
			document.paths[
				'/v1/archive-scans/repair-artifacts/objects/{targetRemoteId}/{candidateRemoteId}/{proofId}/{proofVersion}/{proofEvaluatedAtMs}/{contentDigest}'
			]?.get;
		expect(operation?.description).toContain(
			'independently checks canonical JSON or uncompressed XDR SHA-256'
		);
		expect(
			operation?.responses['200']?.content?.['application/gzip']?.schema
		).toMatchObject({ format: 'binary' });
		expect(
			operation?.responses['409']?.content?.['application/json']?.schema?.$ref
		).toBe(
			'#/components/schemas/HistoryArchiveRepairObjectArtifactUnavailableV1'
		);
	});
});
