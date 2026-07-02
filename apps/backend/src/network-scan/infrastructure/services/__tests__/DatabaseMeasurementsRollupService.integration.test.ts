import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import type { MeasurementsRollupService } from '@network-scan/domain/measurement-aggregation/MeasurementsRollupService.js';
import { NETWORK_TYPES } from '../../di/di-types.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { NodeScan } from '@network-scan/domain/node/scan/NodeScan.js';

describe('DatabaseMeasurementsRollupService.integration', () => {
	let kernel: Kernel;
	let rollupService: MeasurementsRollupService;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		rollupService = kernel.container.get<MeasurementsRollupService>(
			NETWORK_TYPES.MeasurementsRollupService
		);
	});

	afterEach(async () => {
		await kernel.close();
	});

	it('should load the rollup service without errors', async () => {
		expect(rollupService).toBeDefined();
	});

	it('should roll up measurements with no data without throwing errors', async () => {
		const networkScan = new NetworkScan(new Date());
		await expect(
			rollupService.rollupNetworkMeasurements(networkScan)
		).resolves.not.toThrow();

		await expect(
			rollupService.rollupNodeMeasurements(networkScan)
		).resolves.not.toThrow();

		await expect(
			rollupService.rollupOrganizationMeasurements(networkScan)
		).resolves.not.toThrow();
	});
});
