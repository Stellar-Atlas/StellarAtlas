import { OrganizationScanError } from './OrganizationScanError.js';
import { TomlState } from '../TomlState.js';

export class InvalidTomlStateError extends OrganizationScanError {
	constructor(homeDomain: string, tomlState: TomlState) {
		super(
			`Organization toml file for home-domain ${homeDomain} has invalid state ${TomlState[tomlState]}`,
			InvalidTomlStateError.name
		);
	}
}
