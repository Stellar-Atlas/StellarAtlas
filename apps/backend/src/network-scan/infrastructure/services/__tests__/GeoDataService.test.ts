import { ok } from 'neverthrow';
import { LoggerMock } from '@core/services/__mocks__/LoggerMock.js';
import { mock } from 'jest-mock-extended';
import type { HttpService } from 'http-helper';
import { IpStackGeoDataService } from '../IpStackGeoDataService.js';
import { IpWhoIsGeoDataService } from '../IpWhoIsGeoDataService.js';
import { FallbackGeoDataService } from '../FallbackGeoDataService.js';
import { GeoDataUpdateError } from '@network-scan/domain/node/scan/GeoDataService.js';
import type { GeoDataService } from '@network-scan/domain/node/scan/GeoDataService.js';
import { err } from 'neverthrow';

const httpService = mock<HttpService>();

it('should update geoData', async function () {
	const geoDataService = new IpStackGeoDataService(
		new LoggerMock(),
		httpService,
		'key'
	);

	httpService.get.mockReturnValue(
		new Promise((resolve) =>
			resolve(
				ok({
					data: {
						country_code: 'FI',
						country_name: 'Finland',
						latitude: 60.165000915527344,
						longitude: 24.934999465942383,
						connection: {
							isp: 'home'
						}
					},
					status: 200,
					statusText: 'ok',
					headers: {}
				})
			)
		)
	);

	const geoDataOrError = await geoDataService.fetchGeoData('localhost');
	expect(geoDataOrError.isOk()).toBeTruthy();
	if (geoDataOrError.isErr()) return;
	const geoData = geoDataOrError.value;

	expect(geoData.longitude).toEqual(24.934999465942383);
	expect(geoData.latitude).toEqual(60.165000915527344);
	expect(geoData.countryCode).toEqual('FI');
	expect(geoData.countryName).toEqual('Finland');
	expect(geoData.isp).toEqual('home');
});

it('should update geoData from ipwhois fallback shape', async function () {
	const geoDataService = new IpWhoIsGeoDataService(httpService);

	httpService.get.mockResolvedValue(
		ok({
			data: {
				success: true,
				country_code: 'NL',
				country: 'Netherlands',
				latitude: 52.3676,
				longitude: 4.9041,
				connection: {
					isp: 'fallback isp'
				}
			},
			status: 200,
			statusText: 'ok',
			headers: {}
		})
	);

	const geoDataOrError = await geoDataService.fetchGeoData('localhost');
	expect(geoDataOrError.isOk()).toBeTruthy();
	if (geoDataOrError.isErr()) return;
	expect(geoDataOrError.value.countryCode).toEqual('NL');
	expect(geoDataOrError.value.countryName).toEqual('Netherlands');
	expect(geoDataOrError.value.isp).toEqual('fallback isp');
});

it('should call fallback when primary geoData provider fails', async function () {
	const primary = mock<GeoDataService>();
	const fallback = mock<GeoDataService>();
	const expectedGeoData = {
		longitude: 4.9041,
		latitude: 52.3676,
		countryCode: 'NL',
		countryName: 'Netherlands',
		isp: 'fallback isp'
	};
	primary.fetchGeoData.mockResolvedValue(
		err(new GeoDataUpdateError('localhost'))
	);
	fallback.fetchGeoData.mockResolvedValue(ok(expectedGeoData));

	const geoDataService = new FallbackGeoDataService(
		primary,
		fallback,
		new LoggerMock()
	);

	const result = await geoDataService.fetchGeoData('localhost');
	expect(result.isOk()).toBeTruthy();
	expect(fallback.fetchGeoData).toHaveBeenCalledWith('localhost');
	if (result.isOk()) expect(result.value).toEqual(expectedGeoData);
});
