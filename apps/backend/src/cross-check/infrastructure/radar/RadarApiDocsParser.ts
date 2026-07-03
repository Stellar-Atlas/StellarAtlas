import { err, ok, Result } from 'neverthrow';
import {
	radarApiDocsFailure,
	type RadarApiDocsFailureDTO,
	type RadarApiDocsSnapshotDTO,
	type RadarApiOperationDTO,
	type RadarApiOperationMethod,
	type RadarApiServerDTO
} from '../../domain/RadarApiDocs.js';

export interface ParseRadarSwaggerInitializerDTO {
	readonly assetUrl: string;
	readonly contentHashSha256: string;
	readonly documentationUrl: string;
	readonly fetchedAt: string;
	readonly initializer: string;
}

const httpMethods: readonly RadarApiOperationMethod[] = [
	'delete',
	'get',
	'head',
	'options',
	'patch',
	'post',
	'put',
	'trace'
] as const;

export function parseRadarSwaggerInitializer(
	dto: ParseRadarSwaggerInitializerDTO
): Result<RadarApiDocsSnapshotDTO, RadarApiDocsFailureDTO> {
	const swaggerDocOrError = extractSwaggerDocJson(dto.initializer);
	if (swaggerDocOrError.isErr()) return err(swaggerDocOrError.error);

	const parsedOrError = parseJson(swaggerDocOrError.value);
	if (parsedOrError.isErr()) return err(parsedOrError.error);

	const document = parsedOrError.value;
	if (!isRecord(document)) {
		return err(
			radarApiDocsFailure(
				'invalid_openapi',
				'RADAR Swagger doc is not an object'
			)
		);
	}

	const shapeError = validateOpenApiDocument(document);
	if (shapeError) return err(shapeError);

	const info = document.info as Record<string, unknown>;

	return ok({
		assetUrl: dto.assetUrl,
		contentHashSha256: dto.contentHashSha256,
		documentationUrl: dto.documentationUrl,
		fetchedAt: dto.fetchedAt,
		openapiVersion: document.openapi as string,
		operations: readOperations(document),
		servers: readServers(document),
		sourceId: 'withobsrvr-radar',
		title: info.title as string,
		version: info.version as string,
		warnings: readWarnings(document)
	});
}

function extractSwaggerDocJson(
	initializer: string
): Result<string, RadarApiDocsFailureDTO> {
	const swaggerDocMatch = /(?:["']swaggerDoc["']|swaggerDoc)\s*:/.exec(
		initializer
	);
	if (!swaggerDocMatch) {
		if (/(?:["']swaggerUrl["']|swaggerUrl)\s*:/.test(initializer)) {
			return err(
				radarApiDocsFailure(
					'unsupported_shape',
					'RADAR Swagger initializer uses swaggerUrl instead of inline swaggerDoc'
				)
			);
		}

		return err(
			radarApiDocsFailure(
				'parse_error',
				'RADAR Swagger initializer is missing swaggerDoc'
			)
		);
	}

	const objectStart = initializer.indexOf(
		'{',
		swaggerDocMatch.index + swaggerDocMatch[0].length
	);
	if (objectStart === -1) {
		return err(
			radarApiDocsFailure('parse_error', 'RADAR swaggerDoc object is missing')
		);
	}

	const objectEnd = findBalancedObjectEnd(initializer, objectStart);
	if (objectEnd === -1) {
		return err(
			radarApiDocsFailure(
				'parse_error',
				'RADAR swaggerDoc object is incomplete'
			)
		);
	}

	return ok(initializer.slice(objectStart, objectEnd + 1));
}

function findBalancedObjectEnd(input: string, objectStart: number): number {
	let depth = 0;
	let escape = false;
	let quote: '"' | "'" | null = null;

	for (let index = objectStart; index < input.length; index += 1) {
		const char = input[index];

		if (quote) {
			if (escape) {
				escape = false;
				continue;
			}
			if (char === '\\') {
				escape = true;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (char === '{') depth += 1;
		if (char === '}') {
			depth -= 1;
			if (depth === 0) return index;
		}
	}

	return -1;
}

function parseJson(json: string): Result<unknown, RadarApiDocsFailureDTO> {
	try {
		return ok(JSON.parse(json));
	} catch (error) {
		return err(
			radarApiDocsFailure(
				'parse_error',
				error instanceof Error
					? error.message
					: 'RADAR swaggerDoc JSON could not be parsed'
			)
		);
	}
}

function validateOpenApiDocument(
	document: Record<string, unknown>
): RadarApiDocsFailureDTO | null {
	if (typeof document.openapi !== 'string') {
		return radarApiDocsFailure(
			'invalid_openapi',
			'RADAR Swagger doc is missing openapi version'
		);
	}

	const info = document.info;
	if (
		!isRecord(info) ||
		typeof info.title !== 'string' ||
		typeof info.version !== 'string'
	) {
		return radarApiDocsFailure(
			'invalid_openapi',
			'RADAR Swagger doc is missing info.title or info.version'
		);
	}

	if (readServers(document).length === 0) {
		return radarApiDocsFailure(
			'invalid_openapi',
			'RADAR Swagger doc is missing server urls'
		);
	}

	if (!isRecord(document.paths)) {
		return radarApiDocsFailure(
			'invalid_openapi',
			'RADAR Swagger doc is missing paths'
		);
	}

	if (readOperations(document).length === 0) {
		return radarApiDocsFailure(
			'invalid_openapi',
			'RADAR Swagger doc is missing operations'
		);
	}

	return null;
}

function readServers(document: Record<string, unknown>): RadarApiServerDTO[] {
	if (!Array.isArray(document.servers)) return [];

	return document.servers.filter(isRecord).flatMap((server) => {
		if (!isNonEmptyString(server.url)) return [];
		return [
			{
				description: isNonEmptyString(server.description)
					? server.description
					: null,
				url: server.url
			}
		];
	});
}

function readOperations(
	document: Record<string, unknown>
): RadarApiOperationDTO[] {
	const paths = document.paths;
	if (!isRecord(paths)) return [];

	return Object.entries(paths)
		.flatMap(([path, pathItem]) => {
			if (!path.startsWith('/') || !isRecord(pathItem)) return [];
			return httpMethods.flatMap((method) => {
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
	left: RadarApiOperationDTO,
	right: RadarApiOperationDTO
): number {
	const pathCompare = left.path.localeCompare(right.path);
	if (pathCompare !== 0) return pathCompare;

	return httpMethods.indexOf(left.method) - httpMethods.indexOf(right.method);
}

function readWarnings(document: Record<string, unknown>): string[] {
	if (!Array.isArray(document.tags)) return [];

	const documentedTags = new Set(
		document.tags
			.filter(isRecord)
			.map((tag) => tag.name)
			.filter(isNonEmptyString)
	);

	return Array.from(
		new Set(
			readOperations(document)
				.flatMap((operation) => operation.tags)
				.filter((tag) => !documentedTags.has(tag))
				.map((tag) => `Operation tag "${tag}" is missing from top-level tags`)
		)
	).sort();
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}
