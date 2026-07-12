import { Snapshot } from '@core/domain/Snapshot.js';
import type Organization from '@network-scan/domain/organization/Organization.js';
import type {
	KnownOrganizationDTO,
	KnownOrganizationListItemDTO
} from './GetKnownOrganizationsDTO.js';

export function toKnownOrganizationDTO(
	organization: Organization,
	organizationDto: KnownOrganizationDTO['organization']
): KnownOrganizationDTO {
	const current = isCurrentSnapshot(organization.snapshotEndDate);
	const lastMeasurementAt =
		organization.latestMeasurement()?.time.toISOString() ?? null;
	const snapshotEndDate = organization.snapshotEndDate.toISOString();

	return {
		organization: organizationDto,
		current,
		scope: current ? 'current' : 'archived',
		snapshotStartDate: organization.snapshotStartDate.toISOString(),
		snapshotEndDate: current ? null : snapshotEndDate,
		lastSeen: lastMeasurementAt ?? (current ? null : snapshotEndDate),
		lastMeasurementAt
	};
}

export function toKnownOrganizationListItemDTO(
	knownOrganization: KnownOrganizationDTO
): KnownOrganizationListItemDTO {
	return knownOrganization;
}

function isCurrentSnapshot(snapshotEndDate: Date): boolean {
	return snapshotEndDate.getTime() === Snapshot.MAX_DATE.getTime();
}
