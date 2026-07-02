import { CustomError } from '@core/errors/CustomError.js';
import { OrganizationScanError } from './OrganizationScanError.js';

export class InvalidOrganizationIdError extends OrganizationScanError {
	constructor(homeDomain: string, cause: Error) {
		super(
			`Organization id for home-domain ${homeDomain} is invalid`,
			InvalidOrganizationIdError.name,
			cause
		);
	}
}
