import { err, Result } from 'neverthrow';
import {
	radarApiDocsFailure,
	type RadarApiDocsFailureDTO,
	type RadarApiDocsSnapshotDTO
} from '../../domain/RadarApiDocs.js';
import type {
	CrossCheckRadarApiDocsSource,
	RadarApiDocsFetchOptions
} from '../../domain/CrossCheckApiDocsSources.js';
import {
	hashSha256,
	mapRadarFetchError,
	type RadarFetch,
	readBoundedRadarText
} from './RadarHttp.js';
import { parseRadarSwaggerInitializer } from './RadarApiDocsParser.js';

export type RadarApiDocsFetch = RadarFetch;

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

			const bodyOrError = await readBoundedRadarText(
				response,
				maxBytes,
				'RADAR API docs'
			);
			if (bodyOrError.isErr()) {
				return err(
					radarApiDocsFailure(
						bodyOrError.error.kind,
						bodyOrError.error.message,
						{ limitBytes: bodyOrError.error.limitBytes }
					)
				);
			}

			return parseRadarSwaggerInitializer({
				assetUrl: url,
				contentHashSha256: hashSha256(bodyOrError.value),
				documentationUrl: RadarApiDocsSourceAdapter.defaultDocumentationUrl,
				fetchedAt: this.now().toISOString(),
				initializer: bodyOrError.value
			});
		} catch (error) {
			const mappedError = mapRadarFetchError(error);
			return err(radarApiDocsFailure(mappedError.kind, mappedError.message));
		}
	}
}
