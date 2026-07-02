import { CustomError } from '@core/errors/CustomError.js';
import { OrganizationScanError } from './OrganizationScanError.js';

export class WrongNodeScanForOrganizationScan extends OrganizationScanError {
	constructor(organizationScanTime: Date, nodeScanTime: Date) {
		super(
			`OrganizationScan time ${organizationScanTime} does not match NodeScan time ${nodeScanTime}`,
			WrongNodeScanForOrganizationScan.name
		);
	}
}
