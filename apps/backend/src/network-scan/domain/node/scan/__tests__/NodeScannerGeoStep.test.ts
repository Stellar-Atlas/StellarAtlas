import { NodeScannerGeoStep } from '../NodeScannerGeoStep.js';
import { GeoDataUpdateError } from '../GeoDataService.js';
import type { GeoDataService } from '../GeoDataService.js';
import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { NodeScan } from '../NodeScan.js';
import { err, ok } from 'neverthrow';

describe('NodeScannerGeoStep', () => {
	const geoDataService = mock<GeoDataService>();
	const geoStep = new NodeScannerGeoStep(geoDataService, mock<Logger>());

	beforeEach(() => {
		jest.clearAllMocks();
	});
	it('should not update geo-data when no nodes require refresh', function () {
		const nodeScan = mock<NodeScan>();
		nodeScan.getIPsRequiringGeoDataRefresh.mockReturnValue([]);
		geoStep.execute(nodeScan);
		expect(geoDataService.fetchGeoData).not.toHaveBeenCalled();
	});

	it('should update geo-data when node requires refresh', async function () {
		const nodeScan = mock<NodeScan>();
		nodeScan.getIPsRequiringGeoDataRefresh.mockReturnValue(['localhost']);
		geoDataService.fetchGeoData.mockResolvedValue(
			ok({
				latitude: 1,
				longitude: 1,
				countryName: 'country',
				countryCode: 'countryCode',
				isp: 'isp'
			})
		);
		await geoStep.execute(nodeScan);
		expect(nodeScan.updateGeoDataAndISP).toHaveBeenCalled();
	});

	it('should not update geo-data when node changed ip but geo-data service failed', async function () {
		const nodeScan = mock<NodeScan>();
		nodeScan.getIPsRequiringGeoDataRefresh.mockReturnValue(['localhost']);
		geoDataService.fetchGeoData.mockResolvedValue(
			err(new GeoDataUpdateError('test'))
		);
		await geoStep.execute(nodeScan);
		expect(nodeScan.updateGeoDataAndISP).not.toHaveBeenCalled();
		expect(geoDataService.fetchGeoData).toHaveBeenCalled();
	});
});
