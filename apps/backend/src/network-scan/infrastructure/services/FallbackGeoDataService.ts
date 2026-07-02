import type { Logger } from '@core/services/Logger.js';
import {
	GeoData,
	GeoDataUpdateError
} from '../../domain/node/scan/GeoDataService.js';
import type { GeoDataService } from '../../domain/node/scan/GeoDataService.js';
import { Result } from 'neverthrow';

export class FallbackGeoDataService implements GeoDataService {
	constructor(
		private primary: GeoDataService,
		private fallback: GeoDataService,
		private logger: Logger
	) {}

	async fetchGeoData(ip: string): Promise<Result<GeoData, GeoDataUpdateError>> {
		const primaryResult = await this.primary.fetchGeoData(ip);
		if (primaryResult.isOk()) return primaryResult;

		this.logger.info('Primary geoData lookup failed, trying fallback', {
			ip,
			error: primaryResult.error.message
		});

		return this.fallback.fetchGeoData(ip);
	}
}
