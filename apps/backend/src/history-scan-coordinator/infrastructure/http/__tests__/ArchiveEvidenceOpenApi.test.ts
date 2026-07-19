import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

type OpenApiOperation = {
	readonly parameters?: readonly { readonly $ref?: string }[];
	readonly responses: Record<
		string,
		{
			readonly content?: Record<
				string,
				{ readonly schema?: { readonly $ref?: string } }
			>;
		}
	>;
};

type OpenApiSchema = {
	readonly required?: readonly string[];
};

const document = openApiDocument as unknown as {
	readonly components: {
		readonly parameters: Record<
			string,
			{
				readonly schema: {
					readonly default?: number;
					readonly maximum?: number;
					readonly minimum?: number;
				};
			}
		>;
		readonly schemas: Record<string, OpenApiSchema>;
	};
	readonly paths: Record<string, { readonly get?: OpenApiOperation }>;
};

describe('archive evidence OpenAPI contract', () => {
	it.each([
		[
			'/v1/known/nodes/{publicKey}/archive-evidence',
			'#/components/schemas/KnownNodeArchiveEvidenceV1'
		],
		[
			'/v1/known/organizations/{organizationId}/archive-evidence',
			'#/components/schemas/KnownOrganizationArchiveEvidenceV1'
		],
		[
			'/v2/archive-scans/{encodedUrl}/object-evidence',
			'#/components/schemas/HistoryArchiveEvidenceV2'
		]
	])('documents paginated evidence at %s', (path, responseSchema) => {
		const operation = document.paths[path]?.get;
		expect(operation).toBeDefined();
		expect(
			operation?.responses['200']?.content?.['application/json']?.schema?.$ref
		).toBe(responseSchema);
		expect(operation?.responses['429']).toBeDefined();
		expect(operation?.responses['503']).toBeDefined();

		const parameterRefs = operation?.parameters?.flatMap((parameter) =>
			parameter.$ref === undefined ? [] : [parameter.$ref]
		);
		expect(parameterRefs).toEqual(
			expect.arrayContaining([
				'#/components/parameters/ArchiveEvidenceObjectCursor',
				'#/components/parameters/ArchiveEvidenceEventCursor',
				'#/components/parameters/ArchiveEvidenceFailureCursor',
				'#/components/parameters/ArchiveEvidenceWorkerIssueCursor'
			])
		);
	});

	it('preserves the legacy V1 root response without composed page parameters', () => {
		const operation =
			document.paths['/v1/archive-scans/{encodedUrl}/object-evidence']?.get;
		expect(
			operation?.responses['200']?.content?.['application/json']?.schema?.$ref
		).toBe('#/components/schemas/HistoryArchiveEvidenceV1');
		expect(
			operation?.parameters?.some((parameter) =>
				parameter.$ref?.startsWith('#/components/parameters/ArchiveEvidence')
			)
		).toBe(false);
	});

	it('publishes bounded defaults and all composed page fields', () => {
		expect(
			document.components.parameters.ArchiveEvidenceObjectLimit?.schema
		).toMatchObject({ default: 25, maximum: 250, minimum: 0 });
		expect(
			document.components.parameters.ArchiveEvidenceCopyLimit?.schema
		).toMatchObject({ default: 3, maximum: 10, minimum: 1 });
		expect(
			document.components.schemas.HistoryArchiveEvidenceV2?.required
		).toEqual(
			expect.arrayContaining([
				'eventPage',
				'objectPage',
				'remoteFailures',
				'workerIssues'
			])
		);
	});

	it('documents the exact persisted verified-copy object URL', () => {
		expect(
			document.components.schemas.KnownArchiveVerifiedCopyV1?.required
		).toEqual(expect.arrayContaining(['objectUrl']));
	});
});
