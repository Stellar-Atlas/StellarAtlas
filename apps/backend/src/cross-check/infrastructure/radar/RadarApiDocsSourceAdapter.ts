import { createHash } from 'node:crypto';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import {
	radarApiDocsFailure,
	type RadarApiDocsFailureDTO,
	type RadarApiDocsSnapshotDTO
} from '../../domain/RadarApiDocs.js';
import type {
	CrossCheckRadarApiDocsSource,
	RadarApiDocsFetchOptions
} from '../../domain/CrossCheckApiDocsSources.js';
import { parseRadarSwaggerInitializer } from './RadarApiDocsParser.js';

export type RadarApiDocsFetch = (
	input: string | URL,
	init?: RequestInit
) => Promise<Response>;

export type FetchRadarApiDocsOptions = RadarApiDocsFetchOptions;

export class RadarApiDocsSourceAdapter implements CrossCheckRadarApiDocsSource {
	static readonly defaultDocumentationUrl =
		'https://radar.withobsrvr.com/api/docs/';
	static readonly defaultMaxBytes = 1_000_000;
	static readonly defaultTimeoutMs = 5_000;
	static readonly defaultUrl =
		'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js';

	constructor(
		private readonly fetchFn: RadarApiDocsFetch = fetch,
		private readonly now: () => Date = () => new Date()
	) {}

	async fetchDocs(
		options: FetchRadarApiDocsOptions = {}
	): Promise<Result<RadarApiDocsSnapshotDTO, RadarApiDocsFailureDTO>> {
		const url = RadarApiDocsSourceAdapter.defaultUrl;
		const timeoutMs =
			options.timeoutMs ?? RadarApiDocsSourceAdapter.defaultTimeoutMs;
		const maxBytes =
			options.maxBytes ?? RadarApiDocsSourceAdapter.defaultMaxBytes;

		try {
			const response = await this.fetchFn(url, {
				headers: {
					accept: 'application/javascript, text/javascript, */*'
				},
				signal: AbortSignal.timeout(timeoutMs)
			});
			if (!response.ok) {
				return err(
					radarApiDocsFailure(
						'http_status',
						`RADAR API docs returned HTTP ${response.status}`,
						{ status: response.status }
					)
				);
			}

			const bodyOrError = await readBoundedText(response, maxBytes);
			if (bodyOrError.isErr()) return err(bodyOrError.error);

			return parseRadarSwaggerInitializer({
				assetUrl: url,
				contentHashSha256: hashSha256(bodyOrError.value),
				documentationUrl: RadarApiDocsSourceAdapter.defaultDocumentationUrl,
				fetchedAt: this.now().toISOString(),
				initializer: bodyOrError.value
			});
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			return err(
				radarApiDocsFailure(
					isTimeoutError(error) ? 'timeout' : 'network_error',
					mappedError.message
				)
			);
		}
	}
}

async function readBoundedText(
	response: Response,
	maxBytes: number
): Promise<Result<string, RadarApiDocsFailureDTO>> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
		return err(
			radarApiDocsFailure(
				'max_bytes_exceeded',
				'RADAR API docs maxBytes must be a positive integer',
				{ limitBytes: maxBytes }
			)
		);
	}

	if (!response.body) {
		const text = await response.text();
		if (Buffer.byteLength(text, 'utf8') > maxBytes) {
			return err(createMaxBytesExceededFailure(maxBytes));
		}
		return ok(text);
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let byteCount = 0;
	let text = '';

	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;

			byteCount += result.value.byteLength;
			if (byteCount > maxBytes) {
				await reader.cancel().catch(() => undefined);
				return err(createMaxBytesExceededFailure(maxBytes));
			}
			text += decoder.decode(result.value, { stream: true });
		}

		text += decoder.decode();
		return ok(text);
	} finally {
		reader.releaseLock();
	}
}

function createMaxBytesExceededFailure(
	maxBytes: number
): RadarApiDocsFailureDTO {
	return radarApiDocsFailure(
		'max_bytes_exceeded',
		`RADAR API docs response exceeded ${maxBytes} bytes`,
		{ limitBytes: maxBytes }
	);
}

function hashSha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isTimeoutError(error: unknown): boolean {
	if (typeof error !== 'object' || error === null) return false;
	const name = 'name' in error ? error.name : undefined;
	return name === 'TimeoutError' || name === 'AbortError';
}
