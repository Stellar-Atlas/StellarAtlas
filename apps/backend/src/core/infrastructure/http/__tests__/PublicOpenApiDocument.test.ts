import openApiDocument from '../../../../../openapi.json' with { type: 'json' };
import { createPublicOpenApiDocument } from '../PublicOpenApiDocument.js';

describe('public OpenAPI document', () => {
	const document = createPublicOpenApiDocument(openApiDocument);
	const paths = document.paths as Record<string, Record<string, unknown>>;
	const components = document.components as {
		readonly schemas?: Readonly<Record<string, unknown>>;
	};

	it('keeps public data routes and removes operator or cross-check routes', () => {
		expect(paths['/v1/explorer/operations']).toBeDefined();
		expect(paths['/v1/known/nodes']).toBeDefined();
		expect(paths['/v1/archive-scans/objects/status-summary']).toBeDefined();
		expect(
			paths['/v1/archive-scans/repair-artifacts/buckets/{bucketHash}']
		).toBeDefined();
		expect(paths['/v1/history-scan/{url}']).toMatchObject({
			get: { tags: ['Archive verification'] }
		});
		expect(paths['/v1/history-scan/job']).toBeUndefined();
		expect(paths['/v1/community-scanners/register']).toBeUndefined();
		expect(
			Object.keys(paths).some((path) => path.startsWith('/v1/cross-check'))
		).toBe(false);
	});

	it('does not publish private tags, security schemes, or unreferenced schemas', () => {
		const serialized = JSON.stringify(document);
		expect(serialized).not.toContain('CrossCheck');
		expect(serialized).not.toContain('Radar');
		expect(serialized).not.toContain('Community scanner operators');
		expect(serialized).not.toContain('Archive scanner operators');
		expect(Object.keys(components.schemas ?? {})).not.toContain(
			'HistoryArchiveObjectJobDTO'
		);
	});

	it('retains only resolvable local component references', () => {
		for (const reference of componentReferences(document)) {
			expect(resolvePointer(document, reference)).toBeDefined();
		}
	});
});

function componentReferences(value: unknown): string[] {
	const references: string[] = [];
	const visit = (candidate: unknown): void => {
		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item);
			return;
		}
		if (typeof candidate !== 'object' || candidate === null) return;
		const record = candidate as Record<string, unknown>;
		if (
			typeof record.$ref === 'string' &&
			record.$ref.startsWith('#/components/')
		) {
			references.push(record.$ref);
		}
		for (const item of Object.values(record)) visit(item);
	};
	visit(value);
	return references;
}

function resolvePointer(root: unknown, pointer: string): unknown {
	return pointer
		.slice(2)
		.split('/')
		.map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
		.reduce<unknown>((value, part) => {
			if (typeof value !== 'object' || value === null || Array.isArray(value)) {
				return undefined;
			}
			return (value as Record<string, unknown>)[part];
		}, root);
}
