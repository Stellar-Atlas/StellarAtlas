import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

type Schema = {
	readonly additionalProperties?: boolean;
	readonly enum?: readonly string[];
	readonly maxItems?: number;
	readonly oneOf?: readonly Schema[];
	readonly pattern?: string;
	readonly properties?: Record<string, Schema>;
	readonly required?: readonly string[];
	readonly $ref?: string;
};

const document = openApiDocument as unknown as {
	readonly components: { readonly schemas: Record<string, Schema> };
	readonly paths: Record<
		string,
		{
			readonly get?: {
				readonly responses: Record<
					string,
					{
						readonly content?: Record<string, { readonly schema?: Schema }>;
					}
				>;
			};
		}
	>;
};

describe('worker status OpenAPI contract', () => {
	it('publishes strict bounded aggregate and row schemas', () => {
		expect(
			document.paths['/v1/status/workers']?.get?.responses['200']?.content?.[
				'application/json'
			]?.schema?.$ref
		).toBe('#/components/schemas/WorkerStatusDTO');
		expect(document.components.schemas.WorkerStatusDTO).toMatchObject({
			additionalProperties: false
		});
		expect(
			document.components.schemas.ArchiveWorkerStatusDTO?.required
		).toEqual(
			expect.arrayContaining([
				'freshWorkers',
				'missingWorkers',
				'startupGraceActive',
				'telemetryMode',
				'workers'
			])
		);
		expect(
			document.components.schemas.ArchiveWorkerStatusDTO?.properties?.workers
				?.maxItems
		).toBe(128);
		expect(
			document.components.schemas.ArchiveWorkerStatusRowDTO?.required
		).toEqual(
			expect.arrayContaining([
				'currentObject',
				'heartbeatAgeMs',
				'processGeneration',
				'stage'
			])
		);
	});

	it('documents origin-only current-object sources', () => {
		const source =
			document.components.schemas.ArchiveWorkerCurrentObjectDTO?.properties
				?.source;
		expect(source?.oneOf?.[0]?.pattern).toBe('^https?://[^@/?#]+$');
		expect(source?.oneOf?.[1]?.enum).toEqual(['redacted']);
	});

	it('documents deterministic report ordering fields', () => {
		expect(
			document.components.schemas.HistoryArchiveWorkerReportDTO?.required
		).toEqual(expect.arrayContaining(['processGeneration', 'sequence']));
	});
});
