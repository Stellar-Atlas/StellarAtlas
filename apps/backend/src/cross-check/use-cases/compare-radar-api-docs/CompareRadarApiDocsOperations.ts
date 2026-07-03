import 'reflect-metadata';
import { injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type {
	CrossCheckApiDocsComparisonDTO,
	CrossCheckApiDocsFieldMismatchDTO,
	CrossCheckApiDocsOperationComparisonDTO,
	CrossCheckApiDocsOperationDTO,
	CrossCheckApiDocsOperationKeyDTO,
	CrossCheckApiDocsSnapshotMetadataDTO,
	CrossCheckApiDocsComparisonSummaryDTO,
	StellarAtlasApiDocsOperationSnapshotDTO
} from '../../domain/CrossCheckApiDocsComparison.js';
import type {
	RadarApiDocsSnapshotDTO,
	RadarApiOperationDTO,
	RadarApiOperationMethod
} from '../../domain/RadarApiDocs.js';
import { apiDocsOperationMethods } from '../../domain/RadarApiDocs.js';

export interface CompareRadarApiDocsOperationsDTO {
	readonly radar: RadarApiDocsSnapshotDTO;
	readonly stellarAtlas: StellarAtlasApiDocsOperationSnapshotDTO;
}

@injectable()
export class CompareRadarApiDocsOperations {
	constructor(private readonly now: () => Date = () => new Date()) {}

	execute(
		dto: CompareRadarApiDocsOperationsDTO
	): Result<CrossCheckApiDocsComparisonDTO, Error> {
		const operations = compareOperations(
			dto.radar.operations.map(mapRadarOperation),
			dto.stellarAtlas.operations
		);

		return ok({
			comparisonStatus: 'compared',
			generatedAt: this.now().toISOString(),
			operations,
			source: mapRadarMetadata(dto.radar),
			stellarAtlas: mapStellarAtlasMetadata(dto.stellarAtlas),
			summary: summarizeOperations(operations)
		});
	}
}

function compareOperations(
	sourceOperations: readonly CrossCheckApiDocsOperationDTO[],
	stellarAtlasOperations: readonly CrossCheckApiDocsOperationDTO[]
): CrossCheckApiDocsOperationComparisonDTO[] {
	const operationKeys = new Map<string, CrossCheckApiDocsOperationKeyDTO>();
	const sourceByKey = createOperationMap(sourceOperations, operationKeys);
	const stellarAtlasByKey = createOperationMap(
		stellarAtlasOperations,
		operationKeys
	);

	return Array.from(operationKeys.entries())
		.sort((left, right) => compareOperationKeys(left[1], right[1]))
		.map(([lookupKey, key]) =>
			compareOperationPair(
				key,
				sourceByKey.get(lookupKey) ?? null,
				stellarAtlasByKey.get(lookupKey) ?? null
			)
		);
}

function createOperationMap(
	operations: readonly CrossCheckApiDocsOperationDTO[],
	operationKeys: Map<string, CrossCheckApiDocsOperationKeyDTO>
): Map<string, CrossCheckApiDocsOperationDTO> {
	const operationsByKey = new Map<string, CrossCheckApiDocsOperationDTO>();

	operations.forEach((operation) => {
		const lookupKey = createLookupKey(operation);
		if (!operationKeys.has(lookupKey)) {
			operationKeys.set(lookupKey, {
				method: operation.method,
				path: operation.path
			});
		}
		operationsByKey.set(lookupKey, operation);
	});

	return operationsByKey;
}

function compareOperationPair(
	key: CrossCheckApiDocsOperationKeyDTO,
	source: CrossCheckApiDocsOperationDTO | null,
	stellarAtlas: CrossCheckApiDocsOperationDTO | null
): CrossCheckApiDocsOperationComparisonDTO {
	if (source === null) {
		return {
			comparisonStatus: 'source_missing',
			fieldMismatches: [],
			key,
			source,
			stellarAtlas
		};
	}

	if (stellarAtlas === null) {
		return {
			comparisonStatus: 'stellaratlas_missing',
			fieldMismatches: [],
			key,
			source,
			stellarAtlas
		};
	}

	const fieldMismatches = compareOperationFields(source, stellarAtlas);
	return {
		comparisonStatus: fieldMismatches.length > 0 ? 'field_mismatch' : 'matched',
		fieldMismatches,
		key,
		source,
		stellarAtlas
	};
}

function compareOperationFields(
	source: CrossCheckApiDocsOperationDTO,
	stellarAtlas: CrossCheckApiDocsOperationDTO
): CrossCheckApiDocsFieldMismatchDTO[] {
	const fieldMismatches: CrossCheckApiDocsFieldMismatchDTO[] = [];

	if (source.operationId !== stellarAtlas.operationId) {
		fieldMismatches.push({
			field: 'operationId',
			sourceValue: source.operationId,
			stellarAtlasValue: stellarAtlas.operationId
		});
	}

	const sourceSchemaRefs = normalizeStrings(source.schemaRefs);
	const stellarAtlasSchemaRefs = normalizeStrings(stellarAtlas.schemaRefs);
	if (!arraysEqual(sourceSchemaRefs, stellarAtlasSchemaRefs)) {
		fieldMismatches.push({
			field: 'schemaRefs',
			sourceValue: sourceSchemaRefs,
			stellarAtlasValue: stellarAtlasSchemaRefs
		});
	}

	if (source.summary !== stellarAtlas.summary) {
		fieldMismatches.push({
			field: 'summary',
			sourceValue: source.summary,
			stellarAtlasValue: stellarAtlas.summary
		});
	}

	const sourceTags = normalizeStrings(source.tags);
	const stellarAtlasTags = normalizeStrings(stellarAtlas.tags);
	if (!arraysEqual(sourceTags, stellarAtlasTags)) {
		fieldMismatches.push({
			field: 'tags',
			sourceValue: sourceTags,
			stellarAtlasValue: stellarAtlasTags
		});
	}

	return fieldMismatches;
}

function summarizeOperations(
	operations: readonly CrossCheckApiDocsOperationComparisonDTO[]
): CrossCheckApiDocsComparisonSummaryDTO {
	return {
		fieldMismatchCount: countByStatus(operations, 'field_mismatch'),
		matchedCount: countByStatus(operations, 'matched'),
		sourceMissingCount: countByStatus(operations, 'source_missing'),
		stellarAtlasMissingCount: countByStatus(operations, 'stellaratlas_missing'),
		totalCount: operations.length
	};
}

function countByStatus(
	operations: readonly CrossCheckApiDocsOperationComparisonDTO[],
	status: CrossCheckApiDocsOperationComparisonDTO['comparisonStatus']
): number {
	return operations.filter((operation) => operation.comparisonStatus === status)
		.length;
}

function mapRadarOperation(
	operation: RadarApiOperationDTO
): CrossCheckApiDocsOperationDTO {
	return {
		method: operation.method,
		operationId: operation.operationId,
		path: operation.path,
		schemaRefs: [...operation.schemaRefs],
		summary: operation.summary,
		tags: [...operation.tags]
	};
}

function mapRadarMetadata(
	snapshot: RadarApiDocsSnapshotDTO
): CrossCheckApiDocsSnapshotMetadataDTO {
	return {
		documentationUrl: snapshot.documentationUrl,
		observedAt: snapshot.fetchedAt,
		operationCount: snapshot.operations.length,
		sourceId: snapshot.sourceId,
		title: snapshot.title,
		version: snapshot.version
	};
}

function mapStellarAtlasMetadata(
	snapshot: StellarAtlasApiDocsOperationSnapshotDTO
): CrossCheckApiDocsSnapshotMetadataDTO {
	return {
		documentationUrl: snapshot.documentationUrl,
		observedAt: snapshot.loadedAt,
		operationCount: snapshot.operations.length,
		sourceId: snapshot.sourceId,
		title: snapshot.title,
		version: snapshot.version
	};
}

function createLookupKey(operation: CrossCheckApiDocsOperationKeyDTO): string {
	return JSON.stringify([operation.method, operation.path]);
}

function compareOperationKeys(
	left: CrossCheckApiDocsOperationKeyDTO,
	right: CrossCheckApiDocsOperationKeyDTO
): number {
	const pathCompare = left.path.localeCompare(right.path);
	if (pathCompare !== 0) return pathCompare;

	return methodSortIndex(left.method) - methodSortIndex(right.method);
}

function methodSortIndex(method: RadarApiOperationMethod): number {
	return apiDocsOperationMethods.indexOf(method);
}

function normalizeStrings(values: readonly string[]): readonly string[] {
	return Array.from(new Set(values)).sort();
}

function arraysEqual(
	left: readonly string[],
	right: readonly string[]
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}
