import { LoggerMock } from '@core/services/__mocks__/LoggerMock.js';
import Organization from '@network-scan/domain/organization/Organization.js';
import { createDummyOrganizationId } from '@network-scan/domain/organization/__fixtures__/createDummyOrganizationId.js';
import type { OrganizationTomlInfo } from '@network-scan/domain/organization/scan/OrganizationTomlInfo.js';
import { OrganizationTomlFetcher } from '@network-scan/domain/organization/scan/OrganizationTomlFetcher.js';
import type { OrganizationTomlAttemptResult } from '@network-scan/domain/organization/scan/OrganizationTomlFetchResult.js';
import type { TomlState } from '@network-scan/domain/organization/scan/TomlState.js';
import {
	TomlService,
	type TomlFetchWarning
} from '@network-scan/domain/network/scan/TomlService.js';
import { HttpError, type HttpResponse, type HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';

export function createTomlObservation(
	discoveredAt: Date,
	observedAt: Date,
	result: OrganizationTomlAttemptResult,
	state: TomlState,
	content?: string,
	warnings: TomlFetchWarning[] = []
): Organization {
	const organization = Organization.create(
		createDummyOrganizationId(),
		'org.example',
		discoveredAt
	);
	const authoritative = result === 'success' && warnings.length === 0;
	if (authoritative) {
		if (content === undefined) {
			throw new Error('Successful integration observation requires TOML text');
		}
		organization.updateStellarTomlText(content, observedAt);
	}
	organization.recordTomlAttempt(
		result,
		state,
		warnings,
		observedAt,
		content ?? null,
		authoritative
	);
	return organization;
}

export async function fetchWithTlsFallback(
	data: string
): Promise<OrganizationTomlInfo> {
	const httpService = mock<HttpService>();
	const certificateError = new HttpError(
		'certificate has expired',
		'CERT_HAS_EXPIRED'
	);
	const response: HttpResponse<string> = {
		data,
		headers: {},
		status: 200,
		statusText: 'OK'
	};
	httpService.get
		.mockResolvedValueOnce(err(certificateError))
		.mockResolvedValueOnce(err(certificateError))
		.mockResolvedValueOnce(ok(response));
	const logger = new LoggerMock();
	const fetcher = new OrganizationTomlFetcher(
		new TomlService(httpService, logger),
		logger
	);
	const info = (
		await fetcher.fetchOrganizationTomlInfoCollection(['org.example'])
	).get('org.example');
	if (info === undefined) throw new Error('Missing fetched TOML information');
	return info;
}
