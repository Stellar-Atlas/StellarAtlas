import { err, ok, Result } from 'neverthrow';
import { Url } from '@core/domain/Url.js';
import type {
	CrossCheckRadarHistoryArchiveScanSource,
	RadarHistoryArchiveScanDTO,
	RadarHistoryArchiveScanFailureDTO,
	RadarHistoryArchiveScanFetchOptions
} from '../../domain/RadarHistoryArchiveScan.js';
import { radarHistoryArchiveScanFailure } from '../../domain/RadarHistoryArchiveScan.js';
import {
	hashSha256,
	mapRadarFetchError,
	type RadarFetch,
	readBoundedRadarText
} from './RadarHttp.js';

export type RadarHistoryArchiveScanFetch = RadarFetch;
export type FetchRadarHistoryArchiveScanOptions =
	RadarHistoryArchiveScanFetchOptions;

export class RadarHistoryArchiveScanSourceAdapter implements CrossCheckRadarHistoryArchiveScanSource {
	static readonly defaultBaseUrl =
		'https://radar.withobsrvr.com/api/v1/history-scan/';
	static readonly defaultMaxBytes = 100_000;
	static readonly defaultTimeoutMs = 5_000;

	constructor(
		private readonly fetchFn: RadarHistoryArchiveScanFetch = fetch,
		private readonly now: () => Date = () => new Date()
	) {}

	async fetchHistoryArchiveScan(
		archiveUrl: string,
		options: FetchRadarHistoryArchiveScanOptions = {}
	): Promise<
		Result<RadarHistoryArchiveScanDTO | null, RadarHistoryArchiveScanFailureDTO>
	> {
		const encodedUrlOrError = encodeArchiveUrl(archiveUrl);
		if (encodedUrlOrError.isErr()) return err(encodedUrlOrError.error);

		const url =
			RadarHistoryArchiveScanSourceAdapter.defaultBaseUrl +
			encodedUrlOrError.value;
		const timeoutMs =
			options.timeoutMs ??
			RadarHistoryArchiveScanSourceAdapter.defaultTimeoutMs;
		const maxBytes =
			options.maxBytes ?? RadarHistoryArchiveScanSourceAdapter.defaultMaxBytes;

		try {
			const response = await this.fetchFn(url, {
				headers: { accept: 'application/json' },
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (response.status === 404) return ok(null);
			if (!response.ok) {
				return err(
					radarHistoryArchiveScanFailure(
						'http_status',
						`RADAR history archive scan returned HTTP ${response.status}`,
						{ status: response.status }
					)
				);
			}

			const bodyOrError = await readBoundedRadarText(
				response,
				maxBytes,
				'RADAR history archive scan'
			);
			if (bodyOrError.isErr()) {
				return err(
					radarHistoryArchiveScanFailure(
						bodyOrError.error.kind,
						bodyOrError.error.message,
						{ limitBytes: bodyOrError.error.limitBytes }
					)
				);
			}

			return parseRadarHistoryArchiveScan({
				body: bodyOrError.value,
				endpointUrl: url,
				fetchedAt: this.now().toISOString()
			});
		} catch (error) {
			const mappedError = mapRadarFetchError(error);
			return err(
				radarHistoryArchiveScanFailure(mappedError.kind, mappedError.message)
			);
		}
	}
}

interface ParseRadarHistoryArchiveScanDTO {
	readonly body: string;
	readonly endpointUrl: string;
	readonly fetchedAt: string;
}

function parseRadarHistoryArchiveScan(
	dto: ParseRadarHistoryArchiveScanDTO
): Result<RadarHistoryArchiveScanDTO, RadarHistoryArchiveScanFailureDTO> {
	const parsedOrError = parseJson(dto.body);
	if (parsedOrError.isErr()) return err(parsedOrError.error);

	const payload = parsedOrError.value;
	if (!isRecord(payload)) {
		return err(
			radarHistoryArchiveScanFailure(
				'invalid_payload',
				'RADAR history archive scan is not an object'
			)
		);
	}

	const url = readNonEmptyString(payload.url);
	const startDate = readDateTime(payload.startDate);
	const endDate = readDateTime(payload.endDate);
	const hasError = readBoolean(payload.hasError);
	if (!url || !startDate || !endDate || hasError === null) {
		return err(
			radarHistoryArchiveScanFailure(
				'invalid_payload',
				'RADAR history archive scan is missing required fields'
			)
		);
	}

	return ok({
		contentHashSha256: hashSha256(dto.body),
		endDate,
		endpointUrl: dto.endpointUrl,
		errorMessage: readNullableString(payload.errorMessage),
		errorUrl: readNullableString(payload.errorUrl),
		fetchedAt: dto.fetchedAt,
		hasError,
		isSlow: readNullableBoolean(payload.isSlow),
		latestVerifiedLedger: readNullableLedger(payload.latestVerifiedLedger),
		sourceId: 'withobsrvr-radar',
		startDate,
		url
	});
}

function encodeArchiveUrl(
	archiveUrl: string
): Result<string, RadarHistoryArchiveScanFailureDTO> {
	const urlOrError = Url.create(archiveUrl);
	if (urlOrError.isErr()) {
		return err(
			radarHistoryArchiveScanFailure(
				'invalid_archive_url',
				'RADAR history archive scan requires a valid archive URL'
			)
		);
	}

	return ok(encodeURIComponent(urlOrError.value.value));
}

function parseJson(
	body: string
): Result<unknown, RadarHistoryArchiveScanFailureDTO> {
	try {
		return ok(JSON.parse(body));
	} catch (error) {
		return err(
			radarHistoryArchiveScanFailure(
				'invalid_json',
				error instanceof Error
					? error.message
					: 'RADAR history archive scan JSON could not be parsed'
			)
		);
	}
}

function readDateTime(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : value;
}

function readNonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNullableString(value: unknown): string | null {
	return typeof value === 'string' ? value : null;
}

function readBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function readNullableBoolean(value: unknown): boolean | null {
	return typeof value === 'boolean' ? value : null;
}

function readNullableLedger(value: unknown): number | null {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
		? value
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
