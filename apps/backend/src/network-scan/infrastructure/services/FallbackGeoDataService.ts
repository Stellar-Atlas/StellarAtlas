import { Logger } from '../../../core/services/Logger';
import {
	GeoData,
	GeoDataService,
	GeoDataUpdateError
} from '../../domain/node/scan/GeoDataService';
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
