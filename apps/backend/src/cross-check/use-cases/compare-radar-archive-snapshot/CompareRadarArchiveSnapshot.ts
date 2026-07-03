import 'reflect-metadata';
import { injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import { Url } from '@core/domain/Url.js';
import type {
	CrossCheckRadarArchiveComparisonDTO,
	CrossCheckRadarArchiveComparisonStatus,
	CrossCheckRadarArchiveField,
	CrossCheckRadarArchiveFieldMismatchDTO,
	CrossCheckRadarArchiveFieldValue,
	CrossCheckRadarArchiveRecordComparisonDTO,
	CrossCheckRadarArchiveSourceLookupStatus,
	CrossCheckRadarArchiveSourceRowDTO,
	CrossCheckRadarArchiveSourceSnapshotDTO,
	CrossCheckRadarArchiveComparisonSummaryDTO,
	CrossCheckStellarAtlasArchiveRowsDTO
} from '../../domain/CrossCheckRadarArchiveComparison.js';
import type {
	CrossCheckArchiveDTO,
	CrossCheckArchiveEvidenceDTO
} from '../../domain/CrossCheckArchive.js';
import type { RadarHistoryArchiveScanDTO } from '../../domain/RadarHistoryArchiveScan.js';

export interface CompareRadarArchiveSnapshotDTO {
	readonly radar: CrossCheckRadarArchiveSourceSnapshotDTO;
	readonly stellarAtlas: CrossCheckStellarAtlasArchiveRowsDTO;
}

interface SourceRecord {
	readonly archiveUrl: string;
	readonly scan: RadarHistoryArchiveScanDTO | null;
}

@injectable()
export class CompareRadarArchiveSnapshot {
	constructor(private readonly now: () => Date = () => new Date()) {}

	execute(
		dto: CompareRadarArchiveSnapshotDTO
	): Result<CrossCheckRadarArchiveComparisonDTO, Error> {
		const warnings: string[] = [];
		const archives = compareRecords({
			sourceRecords: dto.radar.rows,
			stellarAtlasRecords: dto.stellarAtlas.archives,
			warnings
		});

		return ok({
			archives,
			comparisonStatus: 'compared',
			generatedAt: this.now().toISOString(),
			source: {
				archiveCount: dto.radar.rows.length,
				noScanCount: dto.radar.rows.filter((row) => row.scan === null).length,
				observedAt: dto.radar.generatedAt,
				scanCount: dto.radar.rows.filter((row) => row.scan !== null).length,
				sourceId: dto.radar.sourceId
			},
			stellarAtlas: {
				archiveCount: dto.stellarAtlas.count,
				evidenceSelection: dto.stellarAtlas.evidenceSelection,
				observedAt: dto.stellarAtlas.generatedAt,
				sourceId: 'stellaratlas-api'
			},
			summary: summarizeComparisons(archives),
			warnings
		});
	}
}

interface CompareRecordsDTO {
	readonly sourceRecords: readonly SourceRecord[];
	readonly stellarAtlasRecords: readonly CrossCheckArchiveDTO[];
	readonly warnings: string[];
}

function compareRecords(
	dto: CompareRecordsDTO
): CrossCheckRadarArchiveRecordComparisonDTO[] {
	const keys = new Set<string>();
	const sourceByKey = createSourceRecordMap({
		keys,
		records: dto.sourceRecords,
		warnings: dto.warnings
	});
	const stellarAtlasByKey = createStellarAtlasRecordMap({
		keys,
		records: dto.stellarAtlasRecords,
		warnings: dto.warnings
	});

	return Array.from(keys)
		.sort()
		.map((key) =>
			compareRecordPair({
				key,
				source: sourceByKey.get(key) ?? null,
				stellarAtlas: stellarAtlasByKey.get(key) ?? null
			})
		);
}

interface CreateSourceRecordMapDTO {
	readonly keys: Set<string>;
	readonly records: readonly SourceRecord[];
	readonly warnings: string[];
}

function createSourceRecordMap(
	dto: CreateSourceRecordMapDTO
): Map<string, SourceRecord> {
	const byKey = new Map<string, SourceRecord>();
	dto.records.forEach((record) => {
		const key = archiveKey({
			sourceLabel: 'RADAR',
			url: record.archiveUrl,
			warnings: dto.warnings
		});
		if (byKey.has(key)) {
			dto.warnings.push(`Duplicate RADAR archive key ${key}; last row used`);
		}
		dto.keys.add(key);
		byKey.set(key, record);
	});
	return byKey;
}

interface CreateStellarAtlasRecordMapDTO {
	readonly keys: Set<string>;
	readonly records: readonly CrossCheckArchiveDTO[];
	readonly warnings: string[];
}

function createStellarAtlasRecordMap(
	dto: CreateStellarAtlasRecordMapDTO
): Map<string, CrossCheckArchiveDTO> {
	const byKey = new Map<string, CrossCheckArchiveDTO>();
	dto.records.forEach((record) => {
		const key = archiveKey({
			sourceLabel: 'StellarAtlas',
			url: record.archiveUrl,
			warnings: dto.warnings
		});
		if (byKey.has(key)) {
			dto.warnings.push(
				`Duplicate StellarAtlas archive key ${key}; last row used`
			);
		}
		dto.keys.add(key);
		byKey.set(key, record);
	});
	return byKey;
}

interface ArchiveKeyDTO {
	readonly sourceLabel: 'RADAR' | 'StellarAtlas';
	readonly url: string;
	readonly warnings: string[];
}

function archiveKey(dto: ArchiveKeyDTO): string {
	const urlOrError = Url.create(dto.url);
	if (urlOrError.isOk()) return urlOrError.value.value;

	const fallback = dto.url.trim();
	dto.warnings.push(
		`Invalid ${dto.sourceLabel} archive URL ${dto.url}; raw key used`
	);
	return fallback;
}

interface CompareRecordPairDTO {
	readonly key: string;
	readonly source: SourceRecord | null;
	readonly stellarAtlas: CrossCheckArchiveDTO | null;
}

function compareRecordPair(
	dto: CompareRecordPairDTO
): CrossCheckRadarArchiveRecordComparisonDTO {
	const sourceScan = dto.source?.scan ?? null;
	const sourceLookupStatus = getSourceLookupStatus(dto.source);
	if (dto.source === null) {
		return toRecordComparison({
			comparisonStatus: 'not_loaded',
			fieldMismatches: [],
			key: dto.key,
			source: null,
			sourceLookupStatus,
			stellarAtlas: dto.stellarAtlas?.stellarAtlas ?? null
		});
	}
	if (sourceScan === null) {
		return toRecordComparison({
			comparisonStatus: 'source_missing',
			fieldMismatches: [],
			key: dto.key,
			source: null,
			sourceLookupStatus,
			stellarAtlas: dto.stellarAtlas?.stellarAtlas ?? null
		});
	}
	if (dto.stellarAtlas === null) {
		return toRecordComparison({
			comparisonStatus: 'stellaratlas_missing',
			fieldMismatches: [],
			key: dto.key,
			source: sourceScan,
			sourceLookupStatus,
			stellarAtlas: null
		});
	}

	const fieldMismatches = compareArchiveFields(
		sourceScan,
		dto.stellarAtlas.stellarAtlas
	);
	return toRecordComparison({
		comparisonStatus: fieldMismatches.length > 0 ? 'field_mismatch' : 'matched',
		fieldMismatches,
		key: dto.key,
		source: sourceScan,
		sourceLookupStatus,
		stellarAtlas: dto.stellarAtlas.stellarAtlas
	});
}

function getSourceLookupStatus(
	source: SourceRecord | null
): CrossCheckRadarArchiveSourceLookupStatus {
	if (source === null) return 'not_loaded';
	return source.scan === null ? 'not_found' : 'found';
}

function toRecordComparison(
	dto: CrossCheckRadarArchiveRecordComparisonDTO
): CrossCheckRadarArchiveRecordComparisonDTO {
	return dto;
}

function compareArchiveFields(
	source: RadarHistoryArchiveScanDTO,
	stellarAtlas: CrossCheckArchiveEvidenceDTO
): readonly CrossCheckRadarArchiveFieldMismatchDTO[] {
	return [
		compareField(
			'hasArchiveVerificationError',
			source.hasError,
			stellarAtlas.hasArchiveVerificationError
		),
		compareField(
			'latestVerifiedLedger',
			source.latestVerifiedLedger,
			stellarAtlas.latestVerifiedLedger
		),
		compareField('isSlowArchive', source.isSlow, stellarAtlas.isSlowArchive),
		compareField(
			'archiveVerificationErrorUrls',
			optionalStringSet(source.errorUrl),
			issueUrls(stellarAtlas)
		),
		compareField(
			'archiveVerificationErrorMessages',
			optionalStringSet(source.errorMessage),
			issueMessages(stellarAtlas)
		)
	].filter(isMismatch);
}

function compareField(
	field: CrossCheckRadarArchiveField,
	sourceValue: CrossCheckRadarArchiveFieldValue,
	stellarAtlasValue: CrossCheckRadarArchiveFieldValue
): CrossCheckRadarArchiveFieldMismatchDTO | null {
	if (Array.isArray(sourceValue) || Array.isArray(stellarAtlasValue)) {
		return arraysEqual(arrayValue(sourceValue), arrayValue(stellarAtlasValue))
			? null
			: { field, sourceValue, stellarAtlasValue };
	}

	return sourceValue === stellarAtlasValue
		? null
		: { field, sourceValue, stellarAtlasValue };
}

function optionalStringSet(value: string | null): readonly string[] {
	return value === null ? [] : normalizeStrings([value]);
}

function issueUrls(archive: CrossCheckArchiveEvidenceDTO): readonly string[] {
	return normalizeStrings(
		archive.archiveVerificationErrors.map((issue) => issue.url)
	);
}

function issueMessages(
	archive: CrossCheckArchiveEvidenceDTO
): readonly string[] {
	return normalizeStrings(
		archive.archiveVerificationErrors.map((issue) => issue.message)
	);
}

function summarizeComparisons(
	archives: readonly CrossCheckRadarArchiveRecordComparisonDTO[]
): CrossCheckRadarArchiveComparisonSummaryDTO {
	return {
		archiveCount: archives.length,
		fieldMismatchCount: countByStatus(archives, 'field_mismatch'),
		matchedCount: countByStatus(archives, 'matched'),
		notLoadedCount: countByStatus(archives, 'not_loaded'),
		sourceMissingCount: countByStatus(archives, 'source_missing'),
		stellarAtlasMissingCount: countByStatus(archives, 'stellaratlas_missing'),
		totalCount: archives.length
	};
}

function countByStatus(
	records: readonly CrossCheckRadarArchiveRecordComparisonDTO[],
	status: CrossCheckRadarArchiveComparisonStatus
): number {
	return records.filter((record) => record.comparisonStatus === status).length;
}

function isMismatch(
	value: CrossCheckRadarArchiveFieldMismatchDTO | null
): value is CrossCheckRadarArchiveFieldMismatchDTO {
	return value !== null;
}

function normalizeStrings(values: readonly string[]): readonly string[] {
	return Array.from(new Set(values)).sort();
}

function arrayValue(
	value: CrossCheckRadarArchiveFieldValue
): readonly string[] {
	return Array.isArray(value) ? value : [];
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
