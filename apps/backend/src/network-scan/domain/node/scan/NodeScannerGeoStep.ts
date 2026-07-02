import { inject, injectable } from 'inversify';
import type { GeoDataService } from './GeoDataService.js';
import type { Logger } from '@core/services/Logger.js';
import NodeGeoDataLocation from '../NodeGeoDataLocation.js';
import { NodeScan } from './NodeScan.js';

@injectable()
export class NodeScannerGeoStep {
	constructor(
		@inject('GeoDataService')
		private geoDataService: GeoDataService,
		@inject('Logger')
		private logger: Logger
	) {}

	public async execute(nodeScan: NodeScan): Promise<void> {
		const ips = nodeScan.getIPsRequiringGeoDataRefresh();
		if (ips.length > 0) {
			this.logger.info('Updating geoData info for', {
				nodes: ips
			});

			const ipMap = new Map<
				string,
				{
					geo: NodeGeoDataLocation;
					isp: string | null;
				}
			>();
			await Promise.all(
				ips.map(async (ip: string) => {
					const result = await this.geoDataService.fetchGeoData(ip);
					if (result.isErr()) this.logger.info(result.error.message);
					else {
						ipMap.set(ip, {
							geo: NodeGeoDataLocation.create({
								latitude: result.value.latitude,
								longitude: result.value.longitude,
								countryName: result.value.countryName,
								countryCode: result.value.countryCode
							}),
							isp: result.value.isp
						});
					}
				})
			);
			if (ipMap.size > 0) nodeScan.updateGeoDataAndISP(ipMap);
		}
	}
}
