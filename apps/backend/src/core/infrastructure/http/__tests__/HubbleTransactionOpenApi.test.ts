import { withHubbleOpenApiPaths } from '../HubbleOpenApiDocument.js';
import { readOpenApiRecord } from '../OpenApiDocumentProjection.js';
import { hubbleTypedTransactionSchema } from '../HubbleTransactionOpenApi.js';
describe('typed transaction OpenAPI representation', () => {
	it('retains the dynamic operation ID, optional ledger hint and independently named cursors', () => {
		const document = withHubbleOpenApiPaths({ openapi: '3.0.3', paths: {} });
		const paths = readOpenApiRecord(document.paths)!;
		const operation = readOpenApiRecord(
			readOpenApiRecord(paths['/v1/analytics/transactions/{transactionHash}'])!
				.get
		)!;
		expect(operation.operationId).toBe('getAnalyticsTransaction');
		const parameters = operation.parameters as {
			name: string;
			required: boolean;
		}[];
		expect(parameters.map((p) => p.name)).toEqual(
			expect.arrayContaining([
				'view',
				'ledger_sequence',
				'limit',
				'operations_after',
				'effects_after',
				'events_after'
			])
		);
		expect(parameters.find((p) => p.name === 'ledger_sequence')!.required).toBe(
			false
		);
		expect(operation.description).toContain('default response retains');
		expect(operation.description).toContain(
			'not an immutable backfill snapshot'
		);
		const fields = readOpenApiRecord(hubbleTypedTransactionSchema.properties)!;
		const transaction = readOpenApiRecord(
			readOpenApiRecord(fields.transaction)!.properties
		)!;
		expect(readOpenApiRecord(transaction.feeChargedRaw)!.type).toBe('string');
		expect(readOpenApiRecord(transaction.id)!.type).toBe('string');
		const operationPage = readOpenApiRecord(
			readOpenApiRecord(fields.operations)!.properties
		)!;
		expect(readOpenApiRecord(operationPage.items)!.type).toBe('array');
		expect(operationPage.nextCursor).toBeDefined();
	});
});
