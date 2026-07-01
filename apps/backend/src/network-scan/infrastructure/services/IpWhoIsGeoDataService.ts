import { inject, injectable } from 'inversify';
import { Url, type HttpService } from 'http-helper';
import { err, ok, Result } from 'neverthrow';
import { isNumber, isObject, isString } from 'shared';
import {
	GeoData,
	GeoDataUpdateError
} from '../../domain/node/scan/GeoDataService.js';
import type { GeoDataService } from '../../domain/node/scan/GeoDataService.js';

@injectable()
export class IpWhoIsGeoDataService implements GeoDataService {
	static BaseUrl = 'https://ipwho.is/';

	constructor(@inject('HttpService') private httpService: HttpService) {}

	async fetchGeoData(ip: string): Promise<Result<GeoData, GeoDataUpdateError>> {
		const urlResult = Url.create(IpWhoIsGeoDataService.BaseUrl + ip);
		if (urlResult.isErr())
			return err(new GeoDataUpdateError(ip, urlResult.error));

		const geoDataResponse = await this.httpService.get(urlResult.value);
		if (geoDataResponse.isErr())
			return err(new GeoDataUpdateError(ip, geoDataResponse.error));

		const geoData = geoDataResponse.value.data;
		if (!isObject(geoData))
			return err(new GeoDataUpdateError(ip, new Error('Invalid response')));

		if (geoData.success === false) {
			const message = isString(geoData.message)
				? geoData.message
				: 'IP geodata lookup failed';
			return err(new GeoDataUpdateError(ip, new Error(message)));
		}

		const geoDataResult: GeoData = {
			longitude: isNumber(geoData.longitude) ? geoData.longitude : null,
			latitude: isNumber(geoData.latitude) ? geoData.latitude : null,
			countryName: isString(geoData.country) ? geoData.country : null,
			countryCode: isString(geoData.country_code) ? geoData.country_code : null,
			isp:
				isObject(geoData.connection) && isString(geoData.connection.isp)
					? geoData.connection.isp
					: null
		};

		if (geoDataResult.longitude === null || geoDataResult.latitude === null)
			return err(
				new GeoDataUpdateError(
					ip,
					new Error('Longitude or latitude has null value')
				)
			);

		return ok(geoDataResult);
	}
}
