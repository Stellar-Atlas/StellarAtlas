import { err, ok, Result } from 'neverthrow';
import type {
	CrossCheckRadarNetworkSnapshotSource,
	RadarNetworkFetchOptions,
	RadarNetworkNodeDTO,
	RadarNetworkOrganizationDTO,
	RadarNetworkSnapshotDTO,
	RadarNetworkSnapshotFailureDTO
} from '../../domain/RadarNetworkSnapshot.js';
import { radarNetworkSnapshotFailure } from '../../domain/RadarNetworkSnapshot.js';
import {
	hashSha256,
	mapRadarFetchError,
	type RadarFetch,
	readBoundedRadarText
} from './RadarHttp.js';

export type RadarNetworkSnapshotFetch = RadarFetch;
export type FetchRadarNetworkSnapshotOptions = RadarNetworkFetchOptions;

export class RadarNetworkSnapshotSourceAdapter implements CrossCheckRadarNetworkSnapshotSource {
	static readonly defaultMaxBytes = 2_000_000;
	static readonly defaultTimeoutMs = 5_000;
	static readonly defaultUrl = 'https://radar.withobsrvr.com/api/v1';

	constructor(
		private readonly fetchFn: RadarNetworkSnapshotFetch = fetch,
		private readonly now: () => Date = () => new Date()
	) {}

	async fetchNetworkSnapshot(
		options: FetchRadarNetworkSnapshotOptions = {}
	): Promise<Result<RadarNetworkSnapshotDTO, RadarNetworkSnapshotFailureDTO>> {
		const url = RadarNetworkSnapshotSourceAdapter.defaultUrl;
		const timeoutMs =
			options.timeoutMs ?? RadarNetworkSnapshotSourceAdapter.defaultTimeoutMs;
		const maxBytes =
			options.maxBytes ?? RadarNetworkSnapshotSourceAdapter.defaultMaxBytes;

		try {
			const response = await this.fetchFn(url, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (!response.ok) {
				return err(
					radarNetworkSnapshotFailure(
						'http_status',
						`RADAR network snapshot returned HTTP ${response.status}`,
						{ status: response.status }
					)
				);
			}

			const bodyOrError = await readBoundedRadarText(
				response,
				maxBytes,
				'RADAR network snapshot'
			);
			if (bodyOrError.isErr()) {
				return err(
					radarNetworkSnapshotFailure(
						bodyOrError.error.kind,
						bodyOrError.error.message,
						{ limitBytes: bodyOrError.error.limitBytes }
					)
				);
			}

			return parseRadarNetworkSnapshot({
				body: bodyOrError.value,
				endpointUrl: url,
				fetchedAt: this.now().toISOString()
			});
		} catch (error) {
			const mappedError = mapRadarFetchError(error);
			return err(
				radarNetworkSnapshotFailure(mappedError.kind, mappedError.message)
			);
		}
	}
}

interface ParseRadarNetworkSnapshotDTO {
	readonly body: string;
	readonly endpointUrl: string;
	readonly fetchedAt: string;
}

function parseRadarNetworkSnapshot(
	dto: ParseRadarNetworkSnapshotDTO
): Result<RadarNetworkSnapshotDTO, RadarNetworkSnapshotFailureDTO> {
	const parsedOrError = parseJson(dto.body);
	if (parsedOrError.isErr()) return err(parsedOrError.error);

	const payload = parsedOrError.value;
	if (!isRecord(payload)) {
		return err(
			radarNetworkSnapshotFailure(
				'invalid_payload',
				'RADAR network snapshot is not an object'
			)
		);
	}
	if (!Array.isArray(payload.nodes) || !Array.isArray(payload.organizations)) {
		return err(
			radarNetworkSnapshotFailure(
				'invalid_payload',
				'RADAR network snapshot is missing nodes or organizations'
			)
		);
	}

	const warnings: string[] = [];
	const nodes = payload.nodes.flatMap((node, index) => {
		const mapped = mapNode(node);
		if (!mapped) {
			warnings.push(`Skipped RADAR node at index ${index}: missing publicKey`);
			return [];
		}
		return [mapped];
	});
	const organizations = payload.organizations.flatMap((organization, index) => {
		const mapped = mapOrganization(organization);
		if (!mapped) {
			warnings.push(`Skipped RADAR organization at index ${index}: missing id`);
			return [];
		}
		return [mapped];
	});

	return ok({
		contentHashSha256: hashSha256(dto.body),
		endpointUrl: dto.endpointUrl,
		fetchedAt: dto.fetchedAt,
		latestLedger: readNullableString(payload.latestLedger),
		networkId: readNullableString(payload.id),
		networkName: readNullableString(payload.name),
		networkTime: readNullableString(payload.time),
		nodes,
		organizations,
		sourceId: 'withobsrvr-radar',
		warnings
	});
}

function parseJson(
	body: string
): Result<unknown, RadarNetworkSnapshotFailureDTO> {
	try {
		return ok(JSON.parse(body));
	} catch (error) {
		return err(
			radarNetworkSnapshotFailure(
				'invalid_json',
				error instanceof Error
					? error.message
					: 'RADAR network snapshot JSON could not be parsed'
			)
		);
	}
}

function mapNode(value: unknown): RadarNetworkNodeDTO | null {
	if (!isRecord(value) || !isNonEmptyString(value.publicKey)) return null;

	return {
		active: readNullableBoolean(value.active),
		activeInScp: readNullableBoolean(value.activeInScp),
		alias: readNullableString(value.alias),
		connectivityError: readNullableBoolean(value.connectivityError),
		historyArchiveHasError: readNullableBoolean(value.historyArchiveHasError),
		historyUrl: readNullableString(value.historyUrl),
		homeDomain: readNullableString(value.homeDomain),
		host: readNullableString(value.host),
		index: readNullableNumber(value.index),
		isFullValidator: readNullableBoolean(value.isFullValidator),
		isValidating: readNullableBoolean(value.isValidating),
		isValidator: readNullableBoolean(value.isValidator),
		lag: readNullableNumber(value.lag),
		name: readNullableString(value.name),
		organizationId: readNullableString(value.organizationId),
		publicKey: value.publicKey,
		quorumSetHashKey: readNullableString(value.quorumSetHashKey),
		stellarCoreVersionBehind: readNullableBoolean(
			value.stellarCoreVersionBehind
		),
		versionStr: readNullableString(value.versionStr)
	};
}

function mapOrganization(value: unknown): RadarNetworkOrganizationDTO | null {
	if (!isRecord(value) || !isNonEmptyString(value.id)) return null;

	return {
		homeDomain: readNullableString(value.homeDomain),
		horizonUrl: readNullableString(value.horizonUrl),
		id: value.id,
		name: readNullableString(value.name),
		tomlState: readNullableString(value.tomlState),
		url: readNullableString(value.url),
		validators: readStringArray(value.validators)
	};
}

function readNullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function readNullableBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function readNullableNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): readonly string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === 'string')
		: [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}
