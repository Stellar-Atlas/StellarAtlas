import { OrganizationScanError } from './OrganizationScanError.js';

export class InvalidValidatorPublicKeyError extends OrganizationScanError {
	constructor(homeDomain: string) {
		super(
			`Organization toml file for home-domain ${homeDomain} has an invalid validator set`,
			InvalidValidatorPublicKeyError.name
		);
	}
}
