import Organization from '../../domain/organization/Organization.js';
import { createDummyOrganizationId } from '../../domain/organization/__fixtures__/createDummyOrganizationId.js';
import { TomlState } from '../../domain/organization/scan/TomlState.js';
import { TOML_TLS_CERTIFICATE_WARNING } from '../../domain/network/scan/TomlService.js';
import { OrganizationMapper } from '../OrganizationMapper.js';

describe('OrganizationMapper TOML fallback', () => {
	it('does not attribute retained content to a later insecure retry', () => {
		const goodAt = new Date('2026-07-10T10:00:00.000Z');
		const insecureAt = new Date('2026-07-10T11:00:00.000Z');
		const organization = createOrganization(goodAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[TOML_TLS_CERTIFICATE_WARNING],
			insecureAt,
			'VERSION="2.0.0"\nORG_NAME="unsafe"',
			false,
			'insecure-run'
		);

		expect(
			new OrganizationMapper().toOrganizationDTO(organization).stellarToml
		).toEqual({
			content: 'VERSION="2.0.0"',
			url: 'https://org.example/.well-known/stellar.toml'
		});
	});

	it('timestamps an authoritative attempt carrying the retained body', () => {
		const observedAt = new Date('2026-07-10T10:00:00.000Z');
		const organization = createOrganization(observedAt);
		organization.recordTomlAttempt(
			'success',
			TomlState.Ok,
			[],
			observedAt,
			'VERSION="2.0.0"',
			true,
			'secure-run'
		);

		expect(
			new OrganizationMapper().toOrganizationDTO(organization).stellarToml
		).toMatchObject({ observedAt: observedAt.toISOString() });
	});
});

function createOrganization(at: Date): Organization {
	const organization = Organization.create(
		createDummyOrganizationId(),
		'org.example',
		at
	);
	organization.updateStellarTomlText('VERSION="2.0.0"', at);
	return organization;
}
