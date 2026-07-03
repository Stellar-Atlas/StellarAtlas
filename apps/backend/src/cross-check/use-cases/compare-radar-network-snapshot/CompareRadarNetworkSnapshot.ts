import 'reflect-metadata';
import { injectable } from 'inversify';
import { ok, Result } from 'neverthrow';
import type {
	CrossCheckRadarNetworkComparisonDTO,
	CrossCheckRadarNetworkComparisonStatus,
	CrossCheckRadarNetworkField,
	CrossCheckRadarNetworkFieldMismatchDTO,
	CrossCheckRadarNetworkFieldValue,
	CrossCheckRadarNetworkRecordComparisonDTO,
	CrossCheckRadarNetworkSnapshotMetadataDTO,
	CrossCheckRadarNetworkSourceMetadataDTO,
	CrossCheckRadarNetworkComparisonSummaryDTO,
	CrossCheckStellarAtlasNetworkRowsDTO
} from '../../domain/CrossCheckRadarNetworkComparison.js';
import type { CrossCheckOrganizationEvidenceDTO } from '../../domain/CrossCheckOrganization.js';
import type { CrossCheckValidatorEvidenceDTO as StellarAtlasValidatorEvidenceDTO } from '../../domain/CrossCheckValidator.js';
import type {
	RadarNetworkNodeDTO,
	RadarNetworkOrganizationDTO,
	RadarNetworkSnapshotDTO
} from '../../domain/RadarNetworkSnapshot.js';

export interface CompareRadarNetworkSnapshotDTO {
	readonly radar: RadarNetworkSnapshotDTO;
	readonly stellarAtlas: CrossCheckStellarAtlasNetworkRowsDTO;
}

type SourceRecord = RadarNetworkNodeDTO | RadarNetworkOrganizationDTO;
type StellarAtlasRecord =
	CrossCheckOrganizationEvidenceDTO | StellarAtlasValidatorEvidenceDTO;

@injectable()
export class CompareRadarNetworkSnapshot {
	constructor(private readonly now: () => Date = () => new Date()) {}

	execute(
		dto: CompareRadarNetworkSnapshotDTO
	): Result<CrossCheckRadarNetworkComparisonDTO, Error> {
		const warnings: string[] = [];
		const validators = compareRecords({
			entityType: 'validator',
			sourceRecords: dto.radar.nodes.filter(isRadarValidatorLikeNode),
			stellarAtlasRecords: dto.stellarAtlas.validators.validators.map(
				(validator) => validator.stellarAtlas
			),
			createKey: (record) => record.publicKey,
			compareFields: compareValidatorFields,
			warnings
		});
		const organizations = compareRecords({
			entityType: 'organization',
			sourceRecords: dto.radar.organizations,
			stellarAtlasRecords: dto.stellarAtlas.organizations.organizations.map(
				(organization) => organization.stellarAtlas
			),
			createKey: (record) => record.id,
			compareFields: compareOrganizationFields,
			warnings
		});

		return ok({
			comparisonStatus: 'compared',
			generatedAt: this.now().toISOString(),
			organizations,
			source: mapRadarMetadata(dto.radar),
			stellarAtlas: mapStellarAtlasMetadata(dto.stellarAtlas),
			summary: summarizeComparisons(validators, organizations),
			validators,
			warnings
		});
	}
}

interface CompareRecordsDTO<
	TSource extends SourceRecord,
	TStellarAtlas extends StellarAtlasRecord
> {
	readonly compareFields: (
		source: TSource,
		stellarAtlas: TStellarAtlas
	) => readonly CrossCheckRadarNetworkFieldMismatchDTO[];
	readonly createKey: (record: TSource | TStellarAtlas) => string;
	readonly entityType: CrossCheckRadarNetworkRecordComparisonDTO['entityType'];
	readonly sourceRecords: readonly TSource[];
	readonly stellarAtlasRecords: readonly TStellarAtlas[];
	readonly warnings: string[];
}

function compareRecords<
	TSource extends SourceRecord,
	TStellarAtlas extends StellarAtlasRecord
>(
	dto: CompareRecordsDTO<TSource, TStellarAtlas>
): CrossCheckRadarNetworkRecordComparisonDTO[] {
	const keys = new Set<string>();
	const sourceByKey = createRecordMap({
		createKey: dto.createKey,
		entityType: dto.entityType,
		keys,
		records: dto.sourceRecords,
		sourceLabel: 'RADAR',
		warnings: dto.warnings
	});
	const stellarAtlasByKey = createRecordMap({
		createKey: dto.createKey,
		entityType: dto.entityType,
		keys,
		records: dto.stellarAtlasRecords,
		sourceLabel: 'StellarAtlas',
		warnings: dto.warnings
	});

	return Array.from(keys)
		.sort()
		.map((key) =>
			compareRecordPair({
				compareFields: dto.compareFields,
				entityType: dto.entityType,
				key,
				source: sourceByKey.get(key) ?? null,
				stellarAtlas: stellarAtlasByKey.get(key) ?? null
			})
		);
}

interface CreateRecordMapDTO<TRecord> {
	readonly createKey: (record: TRecord) => string;
	readonly entityType: CrossCheckRadarNetworkRecordComparisonDTO['entityType'];
	readonly keys: Set<string>;
	readonly records: readonly TRecord[];
	readonly sourceLabel: 'RADAR' | 'StellarAtlas';
	readonly warnings: string[];
}

function createRecordMap<TRecord>(
	dto: CreateRecordMapDTO<TRecord>
): Map<string, TRecord> {
	const byKey = new Map<string, TRecord>();
	dto.records.forEach((record) => {
		const key = dto.createKey(record);
		if (byKey.has(key)) {
			dto.warnings.push(
				`Duplicate ${dto.sourceLabel} ${dto.entityType} key ${key}; last row used`
			);
		}
		dto.keys.add(key);
		byKey.set(key, record);
	});
	return byKey;
}

interface CompareRecordPairDTO<
	TSource extends SourceRecord,
	TStellarAtlas extends StellarAtlasRecord
> {
	readonly compareFields: (
		source: TSource,
		stellarAtlas: TStellarAtlas
	) => readonly CrossCheckRadarNetworkFieldMismatchDTO[];
	readonly entityType: CrossCheckRadarNetworkRecordComparisonDTO['entityType'];
	readonly key: string;
	readonly source: TSource | null;
	readonly stellarAtlas: TStellarAtlas | null;
}

function compareRecordPair<
	TSource extends SourceRecord,
	TStellarAtlas extends StellarAtlasRecord
>(
	dto: CompareRecordPairDTO<TSource, TStellarAtlas>
): CrossCheckRadarNetworkRecordComparisonDTO {
	if (dto.source === null) {
		return toRecordComparison({
			comparisonStatus: 'source_missing',
			entityType: dto.entityType,
			fieldMismatches: [],
			key: dto.key,
			source: null,
			stellarAtlas: dto.stellarAtlas
		});
	}
	if (dto.stellarAtlas === null) {
		return toRecordComparison({
			comparisonStatus: 'stellaratlas_missing',
			entityType: dto.entityType,
			fieldMismatches: [],
			key: dto.key,
			source: dto.source,
			stellarAtlas: null
		});
	}

	const fieldMismatches = dto.compareFields(dto.source, dto.stellarAtlas);
	return toRecordComparison({
		comparisonStatus: fieldMismatches.length > 0 ? 'field_mismatch' : 'matched',
		entityType: dto.entityType,
		fieldMismatches,
		key: dto.key,
		source: dto.source,
		stellarAtlas: dto.stellarAtlas
	});
}

function toRecordComparison(
	dto: CrossCheckRadarNetworkRecordComparisonDTO
): CrossCheckRadarNetworkRecordComparisonDTO {
	return dto;
}

function compareValidatorFields(
	source: RadarNetworkNodeDTO,
	stellarAtlas: StellarAtlasValidatorEvidenceDTO
): readonly CrossCheckRadarNetworkFieldMismatchDTO[] {
	return [
		compareField('active', source.active, stellarAtlas.active),
		compareField('activeInScp', source.activeInScp, stellarAtlas.activeInScp),
		compareField('alias', source.alias, stellarAtlas.alias),
		compareField(
			'connectivityError',
			source.connectivityError,
			stellarAtlas.connectivityError
		),
		compareField(
			'historyArchiveHasError',
			source.historyArchiveHasError,
			stellarAtlas.historyArchiveHasError
		),
		compareField('historyUrl', source.historyUrl, stellarAtlas.historyUrl),
		compareField('homeDomain', source.homeDomain, stellarAtlas.homeDomain),
		compareField('host', source.host, stellarAtlas.host),
		compareField(
			'isFullValidator',
			source.isFullValidator,
			stellarAtlas.isFullValidator
		),
		compareField(
			'isValidating',
			source.isValidating,
			stellarAtlas.isValidating
		),
		compareField('isValidator', source.isValidator, stellarAtlas.isValidator),
		compareField('lag', source.lag, stellarAtlas.lag),
		compareField('name', source.name, stellarAtlas.name),
		compareField(
			'organizationId',
			source.organizationId,
			stellarAtlas.organizationId
		),
		compareField(
			'quorumSetHashKey',
			source.quorumSetHashKey,
			stellarAtlas.quorumSetHashKey
		),
		compareField(
			'stellarCoreVersionBehind',
			source.stellarCoreVersionBehind,
			stellarAtlas.stellarCoreVersionBehind
		),
		compareField('versionStr', source.versionStr, stellarAtlas.versionStr)
	].filter(isMismatch);
}

function compareOrganizationFields(
	source: RadarNetworkOrganizationDTO,
	stellarAtlas: CrossCheckOrganizationEvidenceDTO
): readonly CrossCheckRadarNetworkFieldMismatchDTO[] {
	return [
		compareField('homeDomain', source.homeDomain, stellarAtlas.homeDomain),
		compareField('horizonUrl', source.horizonUrl, stellarAtlas.horizonUrl),
		compareField('name', source.name, stellarAtlas.name),
		compareField('tomlState', source.tomlState, stellarAtlas.tomlState),
		compareField('url', source.url, stellarAtlas.url),
		compareField(
			'validators',
			normalizeStrings(source.validators),
			normalizeStrings(stellarAtlas.validatorPublicKeys)
		)
	].filter(isMismatch);
}

function compareField(
	field: CrossCheckRadarNetworkField,
	sourceValue: CrossCheckRadarNetworkFieldValue,
	stellarAtlasValue: CrossCheckRadarNetworkFieldValue
): CrossCheckRadarNetworkFieldMismatchDTO | null {
	if (Array.isArray(sourceValue) || Array.isArray(stellarAtlasValue)) {
		return arraysEqual(arrayValue(sourceValue), arrayValue(stellarAtlasValue))
			? null
			: { field, sourceValue, stellarAtlasValue };
	}

	return sourceValue === stellarAtlasValue
		? null
		: { field, sourceValue, stellarAtlasValue };
}

function summarizeComparisons(
	validators: readonly CrossCheckRadarNetworkRecordComparisonDTO[],
	organizations: readonly CrossCheckRadarNetworkRecordComparisonDTO[]
): CrossCheckRadarNetworkComparisonSummaryDTO {
	const records = [...validators, ...organizations];
	return {
		fieldMismatchCount: countByStatus(records, 'field_mismatch'),
		matchedCount: countByStatus(records, 'matched'),
		organizationCount: organizations.length,
		sourceMissingCount: countByStatus(records, 'source_missing'),
		stellarAtlasMissingCount: countByStatus(records, 'stellaratlas_missing'),
		totalCount: records.length,
		validatorCount: validators.length
	};
}

function countByStatus(
	records: readonly CrossCheckRadarNetworkRecordComparisonDTO[],
	status: CrossCheckRadarNetworkComparisonStatus
): number {
	return records.filter((record) => record.comparisonStatus === status).length;
}

function mapRadarMetadata(
	snapshot: RadarNetworkSnapshotDTO
): CrossCheckRadarNetworkSourceMetadataDTO {
	const validators = snapshot.nodes.filter(isRadarValidatorLikeNode);
	return {
		endpointUrl: snapshot.endpointUrl,
		latestLedger: snapshot.latestLedger,
		networkId: snapshot.networkId,
		networkName: snapshot.networkName,
		networkTime: snapshot.networkTime,
		observedAt: snapshot.fetchedAt,
		organizationCount: snapshot.organizations.length,
		sourceId: snapshot.sourceId,
		validatorCount: validators.length,
		warnings: snapshot.warnings
	};
}

function mapStellarAtlasMetadata(
	rows: CrossCheckStellarAtlasNetworkRowsDTO
): CrossCheckRadarNetworkSnapshotMetadataDTO {
	return {
		observedAt: maxIso([
			rows.validators.generatedAt,
			rows.organizations.generatedAt
		]),
		organizationCount: rows.organizations.totalEligibleCount,
		sourceId: 'stellaratlas-api',
		validatorCount: rows.validators.totalEligibleCount
	};
}

function isRadarValidatorLikeNode(node: RadarNetworkNodeDTO): boolean {
	return (
		node.isValidator === true ||
		node.isValidating === true ||
		node.activeInScp === true
	);
}

function isMismatch(
	value: CrossCheckRadarNetworkFieldMismatchDTO | null
): value is CrossCheckRadarNetworkFieldMismatchDTO {
	return value !== null;
}

function normalizeStrings(values: readonly string[]): readonly string[] {
	return Array.from(new Set(values)).sort();
}

function arrayValue(
	value: CrossCheckRadarNetworkFieldValue
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

function maxIso(values: readonly string[]): string {
	return values.reduce((latest, value) => (value > latest ? value : latest));
}
