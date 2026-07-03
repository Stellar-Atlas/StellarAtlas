import { err, ok, Result } from 'neverthrow';
import type {
	CrossCheckApiDocsOperationDTO,
	StellarAtlasApiDocsOperationSnapshotDTO
} from '../../domain/CrossCheckApiDocsComparison.js';
import { apiDocsOperationMethods } from '../../domain/RadarApiDocs.js';

export type StellarAtlasApiDocsFailureKind = 'invalid_openapi';

export interface StellarAtlasApiDocsFailureDTO {
	readonly kind: StellarAtlasApiDocsFailureKind;
	readonly message: string;
}

export interface ReadStellarAtlasApiDocsOptions {
	readonly documentationUrl?: string | null;
}

export class StellarAtlasApiDocsSourceAdapter {
	static readonly defaultDocumentationUrl = '/docs';

	constructor(
		private readonly openApiDocument: unknown,
		private readonly now: () => Date = () => new Date()
	) {}

	readDocs(
		options: ReadStellarAtlasApiDocsOptions = {}
	): Result<
		StellarAtlasApiDocsOperationSnapshotDTO,
		StellarAtlasApiDocsFailureDTO
	> {
		if (!isRecord(this.openApiDocument)) {
			return err(
				openApiDocsFailure('invalid_openapi', 'OpenAPI doc is not an object')
			);
		}

		const shapeError = validateOpenApiDocument(this.openApiDocument);
		if (shapeError) return err(shapeError);

		const info = this.openApiDocument.info as Record<string, unknown>;

		return ok({
			documentationUrl:
				options.documentationUrl ??
				StellarAtlasApiDocsSourceAdapter.defaultDocumentationUrl,
			loadedAt: this.now().toISOString(),
			operations: readOperations(this.openApiDocument),
			sourceId: 'stellaratlas-api',
			title: info.title as string,
			version: info.version as string
		});
	}
}

function validateOpenApiDocument(
	document: Record<string, unknown>
): StellarAtlasApiDocsFailureDTO | null {
	if (typeof document.openapi !== 'string') {
		return openApiDocsFailure(
			'invalid_openapi',
			'StellarAtlas OpenAPI doc is missing openapi version'
		);
	}

	const info = document.info;
	if (
		!isRecord(info) ||
		typeof info.title !== 'string' ||
		typeof info.version !== 'string'
	) {
		return openApiDocsFailure(
			'invalid_openapi',
			'StellarAtlas OpenAPI doc is missing info.title or info.version'
		);
	}

	if (!isRecord(document.paths)) {
		return openApiDocsFailure(
			'invalid_openapi',
			'StellarAtlas OpenAPI doc is missing paths'
		);
	}

	if (readOperations(document).length === 0) {
		return openApiDocsFailure(
			'invalid_openapi',
			'StellarAtlas OpenAPI doc is missing operations'
		);
	}

	return null;
}

function readOperations(
	document: Record<string, unknown>
): CrossCheckApiDocsOperationDTO[] {
	const paths = document.paths;
	if (!isRecord(paths)) return [];

	return Object.entries(paths)
		.flatMap(([path, pathItem]) => {
			if (!path.startsWith('/') || !isRecord(pathItem)) return [];
			return apiDocsOperationMethods.flatMap((method) => {
				const operation = pathItem[method];
				if (!isRecord(operation)) return [];
				return [
					{
						method,
						operationId: isNonEmptyString(operation.operationId)
							? operation.operationId
							: null,
						path,
						schemaRefs: collectSchemaRefs(operation),
						summary: isNonEmptyString(operation.summary)
							? operation.summary
							: null,
						tags: readStringArray(operation.tags)
					}
				];
			});
		})
		.sort(compareOperations);
}

function compareOperations(
	left: CrossCheckApiDocsOperationDTO,
	right: CrossCheckApiDocsOperationDTO
): number {
	const pathCompare = left.path.localeCompare(right.path);
	if (pathCompare !== 0) return pathCompare;

	return (
		apiDocsOperationMethods.indexOf(left.method) -
		apiDocsOperationMethods.indexOf(right.method)
	);
}

function collectSchemaRefs(value: unknown): string[] {
	const refs = new Set<string>();
	collectSchemaRefsInto(value, refs);
	return Array.from(refs).sort();
}

function collectSchemaRefsInto(value: unknown, refs: Set<string>): void {
	if (Array.isArray(value)) {
		value.forEach((item) => collectSchemaRefsInto(item, refs));
		return;
	}

	if (!isRecord(value)) return;

	if (isNonEmptyString(value.$ref)) refs.add(value.$ref);
	Object.values(value).forEach((item) => collectSchemaRefsInto(item, refs));
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isNonEmptyString);
}

function openApiDocsFailure(
	kind: StellarAtlasApiDocsFailureKind,
	message: string
): StellarAtlasApiDocsFailureDTO {
	return { kind, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
