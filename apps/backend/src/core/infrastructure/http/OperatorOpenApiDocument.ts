import {
	projectOpenApiDocument,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';
import { isOperatorOpenApiOperation } from './OpenApiOperationClassification.js';

const operatorTags = [
	{
		description: 'Authenticated archive scanner worker and backfill routes.',
		name: 'Archive scanner operators'
	},
	{
		description: 'Community scanner registration, work, and telemetry routes.',
		name: 'Community scanner operators'
	},
	{
		description: 'Internal external-source comparison and review endpoints.',
		name: 'CrossCheck'
	}
] as const;

export function createOperatorOpenApiDocument(
	document: unknown
): OpenApiRecord {
	return projectOpenApiDocument(document, {
		includeOperation: isOperatorOpenApiOperation,
		includeSecuritySchemes: true,
		info: {
			description:
				'Operator, worker, community scanner, and internal comparison endpoints. Access to this document requires StellarAtlas operator credentials; individual endpoints retain their documented authentication requirements.',
			title: 'StellarAtlas Operator API'
		},
		servers: [
			{
				description: 'StellarAtlas production API',
				url: 'https://api.stellaratlas.io'
			}
		],
		tags: operatorTags
	});
}
