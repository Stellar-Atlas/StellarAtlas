import { mock, type MockProxy } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';
import type { GetKnownOrganizations } from '../../get-known-organizations/GetKnownOrganizations.js';
import type { KnownOrganizationListItemDTO } from '../../get-known-organizations/GetKnownOrganizationsDTO.js';

export function knownOrganizations(
	assignments: readonly (readonly [string, string])[] = []
): MockProxy<GetKnownOrganizations> {
	const validatorsByOrganization = new Map<string, string[]>();
	for (const [validator, organizationId] of assignments) {
		const validators = validatorsByOrganization.get(organizationId) ?? [];
		validators.push(validator);
		validatorsByOrganization.set(organizationId, validators);
	}
	const organizations = [...validatorsByOrganization]
		.map(([organizationId, validators]) =>
			knownOrganization(organizationId, validators)
		)
		.toSorted((left, right) =>
			left.organization.id.localeCompare(right.organization.id)
		);
	const getKnownOrganizations = mock<GetKnownOrganizations>();
	getKnownOrganizations.executeAll.mockResolvedValue(
		ok({
			count: organizations.length,
			generatedAt: '2026-07-11T00:00:00.000Z',
			organizations,
			scopeTotals: {
				'all-known': organizations.length,
				archived: 0,
				current: organizations.length
			},
			source: 'postgres_canonical'
		})
	);
	return getKnownOrganizations;
}

function knownOrganization(
	organizationId: string,
	validators: readonly string[]
): KnownOrganizationListItemDTO {
	const organization = createDummyOrganizationV1();
	organization.id = organizationId;
	organization.validators = [...validators];
	return {
		current: true,
		lastMeasurementAt: null,
		lastSeen: null,
		organization,
		scope: 'current',
		snapshotEndDate: null,
		snapshotStartDate: '2026-07-11T00:00:00.000Z'
	};
}
