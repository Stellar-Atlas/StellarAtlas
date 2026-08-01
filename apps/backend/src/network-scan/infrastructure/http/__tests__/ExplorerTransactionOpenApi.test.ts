import openApiDocument from '../../../../../openapi.json' with { type: 'json' };

interface OpenApiSchema {
	readonly enum?: readonly string[];
	readonly properties?: Record<string, OpenApiSchema>;
	readonly required?: readonly string[];
}

const document = openApiDocument as unknown as {
	readonly components: {
		readonly schemas: Record<string, OpenApiSchema>;
	};
};

describe('Explorer transaction OpenAPI contract', () => {
	it('documents freshness, data-through time, and selection metadata', () => {
		const schema = document.components.schemas.RecentTransactions;
		expect(schema?.required).toEqual(
			expect.arrayContaining([
				'dataThrough',
				'freshness',
				'freshnessThresholdMs',
				'selectionReason',
				'source'
			])
		);
		expect(schema?.properties?.freshness?.enum).toEqual([
			'fresh',
			'stale',
			'unknown'
		]);
		expect(schema?.properties?.source?.enum).toEqual([
			'local_history',
			'live_network'
		]);
		expect(schema?.properties?.selectionReason?.enum).toEqual([
			'local_history_current',
			'local_history_empty',
			'local_history_behind',
			'live_network_unavailable'
		]);
	});
});
