import { OrganizationScanError } from './OrganizationScanError.js';

export class CouldNotRetrieveArchivedOrganizationsError extends OrganizationScanError {
	constructor(cause: Error) {
		super(
			'Could not retrieve archived organizations',
			CouldNotRetrieveArchivedOrganizationsError.name,
			cause
		);
	}
}
