/// <reference types="jest" />

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicOrganization } from '../../../api/types';
import { OrganizationTomlEvidence } from '../organization-toml-evidence';

describe('OrganizationTomlEvidence', () => {
	it('keeps the last good document visible after a later failure', () => {
		const html = render(
			createOrganization({
				stellarToml: {
					content: 'VERSION="2.0.0"',
					observedAt: '2026-07-10T10:00:00.000Z',
					url: 'https://org.example/.well-known/stellar.toml',
					warnings: []
				},
				tomlLatestAttempt: {
					observedAt: '2026-07-10T12:00:00.000Z',
					result: 'failure',
					state: 'ParsingError',
					warnings: []
				},
				tomlLatestFailure: {
					observedAt: '2026-07-10T12:00:00.000Z',
					result: 'failure',
					state: 'ParsingError',
					warnings: []
				}
			})
		);

		expect(html).toContain('Latest fetch attempt');
		expect(html).toContain('Retained failure');
		expect(html).toContain('The latest fetch failed.');
		expect(html).toContain('VERSION=&quot;2.0.0&quot;');
		expect(html).toContain('Authoritative certificate-verified content');
	});

	it('reports an insecure successful retry as TLS evidence', () => {
		const success = {
			authoritative: false,
			contentCaptured: true,
			observedAt: '2026-07-10T10:00:00.000Z',
			result: 'success' as const,
			state: 'Ok' as const,
			warnings: ['TlsCertificateVerificationDisabled' as const]
		};
		const html = render(
			createOrganization({
				stellarToml: {
					content: 'VERSION="2.0.0" # prior',
					observedAt: '2026-07-10T09:00:00.000Z',
					url: 'https://org.example/.well-known/stellar.toml',
					warnings: []
				},
				tomlLatestAttempt: success,
				tomlLatestFailure: null,
				tomlLatestInsecureAttempt: success
			})
		);

		expect(html).toContain('Succeeded');
		expect(html).toContain('TLS verification disabled');
		expect(html).toContain('Quarantined');
		expect(html).toContain('was not used for organization metadata');
		expect(html).toContain('VERSION=&quot;2.0.0&quot; # prior');
		expect(html).not.toContain('The latest fetch failed.');
	});

	it('renders a legacy V1 organization without additive evidence fields', () => {
		const organization = createOrganization({
			stellarToml: {
				content: 'VERSION="2.0.0"',
				url: 'https://org.example/.well-known/stellar.toml'
			}
		});
		delete organization.tomlLatestAttempt;
		delete organization.tomlLatestFailure;
		delete organization.tomlLatestInsecureAttempt;

		const html = render(organization);

		expect(html).toContain('Not recorded');
		expect(html).toContain('Time unavailable');
		expect(html).toContain('VERSION=&quot;2.0.0&quot;');
		expect(html).toContain('Legacy retained content; provenance unavailable');
		expect(html).not.toContain('Authoritative certificate-verified content');
	});

	it('does not label legacy TLS-fallback content authoritative', () => {
		const html = render(
			createOrganization({
				stellarToml: {
					content: 'VERSION="2.0.0"',
					url: 'https://org.example/.well-known/stellar.toml',
					warnings: ['TlsCertificateVerificationDisabled']
				}
			})
		);

		expect(html).toContain('Legacy TLS-fallback content; non-authoritative');
		expect(html).toContain(
			'displayed as retained evidence, not trusted metadata'
		);
		expect(html).not.toContain('Authoritative certificate-verified content');
	});
});

function render(organization: PublicOrganization): string {
	return renderToStaticMarkup(
		createElement(OrganizationTomlEvidence, { organization })
	);
}

function createOrganization(
	overrides: Partial<PublicOrganization> = {}
): PublicOrganization {
	return {
		dateDiscovered: '2020-01-01T00:00:00.000Z',
		dba: null,
		description: null,
		github: null,
		has24HourStats: false,
		has30DayStats: false,
		hasReliableUptime: false,
		homeDomain: 'org.example',
		horizonUrl: null,
		id: 'org-id',
		keybase: null,
		logo: null,
		name: 'Example organization',
		officialEmail: null,
		phoneNumber: null,
		physicalAddress: null,
		stellarToml: null,
		subQuorum24HoursAvailability: 0,
		subQuorum30DaysAvailability: 0,
		subQuorumAvailable: false,
		tomlState: 'Unknown',
		tomlWarnings: [],
		twitter: null,
		url: null,
		validators: [],
		...overrides
	};
}
