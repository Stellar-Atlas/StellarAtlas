import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import networkSchema from 'shared/schemas/network.json' with { type: 'json' };
import nodeSchema from 'shared/schemas/node.json' with { type: 'json' };
import organizationSchema from 'shared/schemas/organization.json' with { type: 'json' };
import { HistoryArchiveStatusSummaryV1Schema } from 'shared';
import { createPublicOpenApiDocument } from '../PublicOpenApiDocument.js';
import {
	projectOpenApiDocument,
	type OpenApiRecord
} from '../OpenApiDocumentProjection.js';
import {
	assertSelfContainedOpenApiDocument,
	withLocalPublicOpenApiSchemas
} from '../LocalPublicOpenApiSchemas.js';

describe('self-contained public OpenAPI schemas', () => {
	const document = createPublicOpenApiDocument(openApiDocument);
	const components = (
		document.components as { schemas: Record<string, OpenApiRecord> }
	).schemas;
	it('registers the exact runtime transition-reconciliation schema', () => {
		expect(components.HistoryArchiveTransitionReconciliationV1).toEqual(
			HistoryArchiveStatusSummaryV1Schema.properties.transitionReconciliation
		);
	});
	it('preserves authoritative local schema constraints and recursive references', () => {
		expect(components.StellarAtlasNetwork?.required).toEqual(
			networkSchema.required
		);
		expect(components.StellarAtlasNode?.required).toEqual(nodeSchema.required);
		expect(components.StellarAtlasOrganization?.required).toEqual(
			organizationSchema.required
		);
		expect(components.StellarAtlasNode__QuorumSet).toMatchObject({
			required: nodeSchema.definitions.QuorumSet.required,
			properties: {
				innerQuorumSets: {
					items: { $ref: '#/components/schemas/StellarAtlasNode__QuorumSet' }
				}
			}
		});
		expect(
			components.StellarAtlasOrganization__OrganizationTomlFailureV1
		).toMatchObject({
			properties: {
				state: {
					$ref: '#/components/schemas/StellarAtlasOrganization__OrganizationTomlAttemptV1/properties/state'
				}
			}
		});
		expect(
			components.StellarAtlasOrganization__OrganizationTomlAttemptV1?.properties
		).toEqual(
			organizationSchema.definitions.OrganizationTomlAttemptV1.properties
		);
		expect(components.StellarAtlasNodeSnapshot).toMatchObject({
			properties: { node: { $ref: '#/components/schemas/StellarAtlasNode' } }
		});
		expect(components.StellarAtlasOrganizationSnapshot).toMatchObject({
			properties: {
				organization: { $ref: '#/components/schemas/StellarAtlasOrganization' }
			}
		});
		expect(components.StellarAtlasOrganizationSnapshot).not.toHaveProperty(
			'$id'
		);
	});
	it('resolves all references in every actual isolated public operation without external fetches', () => {
		assertSelfContainedOpenApiDocument(document);
		const methods = new Set([
			'get',
			'post',
			'put',
			'patch',
			'delete',
			'head',
			'options'
		]);
		let operationCount = 0;
		for (const [path, item] of Object.entries(
			document.paths as Record<string, OpenApiRecord>
		)) {
			for (const [method, operation] of Object.entries(item)) {
				if (!methods.has(method)) continue;
				const isolated = projectOpenApiDocument(document, {
					includeOperation: (candidate) =>
						candidate.path === path && candidate.method === method,
					includeSecuritySchemes: true,
					info: document.info as OpenApiRecord,
					servers: document.servers as OpenApiRecord[],
					tags: document.tags as OpenApiRecord[]
				});
				expect(() =>
					assertSelfContainedOpenApiDocument(isolated)
				).not.toThrow();
				expect(
					(isolated.paths as Record<string, OpenApiRecord>)[path]?.[method]
				).toEqual(operation);
				expect(Object.keys(isolated.paths as OpenApiRecord)).toEqual([path]);
				operationCount++;
			}
		}
		expect(operationCount).toBe(115);
	});
	it('retains a referenced component when the only reference points into one property', () => {
		const source = {
			openapi: '3.0.3',
			info: {},
			paths: {
				'/test': {
					get: {
						responses: {
							200: {
								content: {
									'application/json': {
										schema: {
											$ref: '#/components/schemas/Shared/properties/status'
										}
									}
								}
							}
						}
					}
				}
			},
			components: {
				schemas: {
					Shared: {
						type: 'object',
						properties: { status: { type: 'string', enum: ['ready'] } }
					},
					Unused: { type: 'string' }
				}
			}
		};
		const projected = projectOpenApiDocument(source, {
			includeOperation: () => true,
			info: {},
			servers: [],
			tags: []
		});
		expect(() => assertSelfContainedOpenApiDocument(projected)).not.toThrow();
		expect(
			(projected.components as { schemas: OpenApiRecord }).schemas
		).not.toHaveProperty('Unused');
	});
	it('rejects unregistered external refs and unresolved local refs instead of fetching them', () => {
		expect(() =>
			withLocalPublicOpenApiSchemas({
				paths: {},
				example: { $ref: 'https://untrusted.example/private.json' }
			})
		).toThrow('Unregistered');
		expect(() =>
			assertSelfContainedOpenApiDocument({ $ref: '#/missing' })
		).toThrow('Unresolved');
		expect(() =>
			assertSelfContainedOpenApiDocument({
				$ref: 'https://stellaratlas.io/schemas/node.json'
			})
		).toThrow('External');
	});
});
