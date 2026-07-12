import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

interface OpenApiParameter {
	readonly name?: string;
	readonly schema?: {
		readonly maximum?: number;
		readonly minimum?: number;
	};
}

const document = openApiDocument as unknown as {
	readonly paths: Record<
		string,
		{
			readonly get?: {
				readonly operationId?: string;
				readonly parameters?: readonly OpenApiParameter[];
			};
		}
	>;
};

describe('SCP evidence OpenAPI contract', () => {
	it('documents the bounded compact animation backlog', () => {
		const operation = document.paths['/v1/scp/evidence/animation-backlog']?.get;
		const limit = operation?.parameters?.find(
			(parameter) => parameter.name === 'limit'
		);

		expect(operation?.operationId).toBe('getScpAnimationBacklog');
		expect(limit?.schema).toMatchObject({ maximum: 25, minimum: 1 });
	});
});
