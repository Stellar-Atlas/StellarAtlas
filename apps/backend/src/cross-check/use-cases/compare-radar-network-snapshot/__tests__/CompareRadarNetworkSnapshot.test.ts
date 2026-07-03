import type {
	CrossCheckOrganizationDTO,
	CrossCheckOrganizationEvidenceDTO,
	CrossCheckOrganizationsDTO
} from '../../../domain/CrossCheckOrganization.js';
import type {
	CrossCheckValidatorDTO,
	CrossCheckValidatorEvidenceDTO,
	CrossCheckValidatorsDTO
} from '../../../domain/CrossCheckValidator.js';
import type {
	RadarNetworkNodeDTO,
	RadarNetworkOrganizationDTO,
	RadarNetworkSnapshotDTO
} from '../../../domain/RadarNetworkSnapshot.js';
import { CompareRadarNetworkSnapshot } from '../CompareRadarNetworkSnapshot.js';

describe('CompareRadarNetworkSnapshot', () => {
	it('should compare validator and organization record presence by stable keys', () => {
		const useCase = new CompareRadarNetworkSnapshot(
			() => new Date('2026-07-03T15:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot({
				nodes: [
					createRadarNode({ publicKey: 'GA', isValidator: true }),
					createRadarNode({ publicKey: 'GB', isValidating: true }),
					createRadarNode({
						activeInScp: false,
						isValidator: false,
						isValidating: false,
						publicKey: 'GN'
					})
				],
				organizations: [
					createRadarOrganization({ id: 'org-a' }),
					createRadarOrganization({ id: 'org-b' })
				]
			}),
			stellarAtlas: {
				validators: createStellarAtlasValidators([
					createValidatorRow({ publicKey: 'GA', isValidator: true }),
					createValidatorRow({ publicKey: 'GC', activeInScp: true })
				]),
				organizations: createStellarAtlasOrganizations([
					createOrganizationRow({ organizationId: 'org-a' }),
					createOrganizationRow({ organizationId: 'org-c' })
				])
			}
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value).toMatchObject({
			comparisonStatus: 'compared',
			generatedAt: '2026-07-03T15:00:00.000Z',
			summary: {
				fieldMismatchCount: 0,
				matchedCount: 2,
				organizationCount: 3,
				sourceMissingCount: 2,
				stellarAtlasMissingCount: 2,
				totalCount: 6,
				validatorCount: 3
			},
			source: {
				observedAt: '2026-07-03T14:00:00.000Z',
				organizationCount: 2,
				sourceId: 'withobsrvr-radar',
				validatorCount: 2
			},
			stellarAtlas: {
				observedAt: '2026-07-03T14:10:00.000Z',
				organizationCount: 2,
				sourceId: 'stellaratlas-api',
				validatorCount: 2
			},
			warnings: []
		});
		expect(
			result.value.validators.map((validator) => ({
				key: validator.key,
				status: validator.comparisonStatus
			}))
		).toEqual([
			{ key: 'GA', status: 'matched' },
			{ key: 'GB', status: 'stellaratlas_missing' },
			{ key: 'GC', status: 'source_missing' }
		]);
		expect(
			result.value.organizations.map((organization) => ({
				key: organization.key,
				status: organization.comparisonStatus
			}))
		).toEqual([
			{ key: 'org-a', status: 'matched' },
			{ key: 'org-b', status: 'stellaratlas_missing' },
			{ key: 'org-c', status: 'source_missing' }
		]);
	});

	it('should report field mismatches and compare organization validators as sets', () => {
		const useCase = new CompareRadarNetworkSnapshot(
			() => new Date('2026-07-03T15:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot({
				nodes: [
					createRadarNode({
						active: true,
						alias: 'radar-alias',
						connectivityError: false,
						historyArchiveHasError: true,
						isValidator: true,
						lag: 3,
						publicKey: 'GA',
						versionStr: '25.0.0'
					})
				],
				organizations: [
					createRadarOrganization({
						id: 'org-a',
						validators: ['GB', 'GA']
					})
				]
			}),
			stellarAtlas: {
				validators: createStellarAtlasValidators([
					createValidatorRow({
						active: false,
						activeInScp: false,
						alias: 'atlas-alias',
						connectivityError: true,
						historyArchiveHasError: false,
						isValidator: true,
						lag: 5,
						publicKey: 'GA',
						versionStr: '25.1.0'
					})
				]),
				organizations: createStellarAtlasOrganizations([
					createOrganizationRow({
						organizationId: 'org-a',
						validatorPublicKeys: ['GA', 'GB']
					})
				])
			}
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.summary).toMatchObject({
			fieldMismatchCount: 1,
			matchedCount: 1,
			totalCount: 2
		});
		expect(result.value.organizations[0].comparisonStatus).toBe('matched');
		expect(result.value.validators[0]).toMatchObject({
			comparisonStatus: 'field_mismatch',
			key: 'GA',
			fieldMismatches: [
				{ field: 'active', sourceValue: true, stellarAtlasValue: false },
				{
					field: 'activeInScp',
					sourceValue: true,
					stellarAtlasValue: false
				},
				{
					field: 'alias',
					sourceValue: 'radar-alias',
					stellarAtlasValue: 'atlas-alias'
				},
				{
					field: 'connectivityError',
					sourceValue: false,
					stellarAtlasValue: true
				},
				{
					field: 'historyArchiveHasError',
					sourceValue: true,
					stellarAtlasValue: false
				},
				{ field: 'lag', sourceValue: 3, stellarAtlasValue: 5 },
				{
					field: 'versionStr',
					sourceValue: '25.0.0',
					stellarAtlasValue: '25.1.0'
				}
			]
		});
	});

	it('should compare null fields without inventing mismatches', () => {
		const useCase = new CompareRadarNetworkSnapshot(
			() => new Date('2026-07-03T15:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot({
				nodes: [
					createRadarNode({
						homeDomain: null,
						historyUrl: null,
						isValidator: true,
						name: null,
						organizationId: null,
						publicKey: 'GA',
						quorumSetHashKey: null
					})
				],
				organizations: [
					createRadarOrganization({
						homeDomain: null,
						id: 'org-a',
						name: null,
						url: null
					})
				]
			}),
			stellarAtlas: {
				validators: createStellarAtlasValidators([
					createValidatorRow({
						homeDomain: null,
						historyUrl: null,
						isValidator: true,
						name: null,
						organizationId: null,
						publicKey: 'GA',
						quorumSetHashKey: null
					})
				]),
				organizations: createStellarAtlasOrganizations([
					createOrganizationRow({
						homeDomain: null,
						name: null,
						organizationId: 'org-a',
						url: null
					})
				])
			}
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.summary).toMatchObject({
			fieldMismatchCount: 0,
			matchedCount: 2,
			totalCount: 2
		});
	});

	it('should warn on duplicate keys and use the last row deterministically', () => {
		const useCase = new CompareRadarNetworkSnapshot(
			() => new Date('2026-07-03T15:00:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot({
				nodes: [
					createRadarNode({
						name: 'first-radar',
						publicKey: 'GA',
						isValidator: true
					}),
					createRadarNode({
						name: 'last-radar',
						publicKey: 'GA',
						isValidator: true
					})
				],
				organizations: []
			}),
			stellarAtlas: {
				validators: createStellarAtlasValidators([
					createValidatorRow({ name: 'first-atlas', publicKey: 'GA' }),
					createValidatorRow({
						isValidator: true,
						name: 'last-atlas',
						publicKey: 'GA'
					})
				]),
				organizations: createStellarAtlasOrganizations([])
			}
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.warnings).toEqual([
			'Duplicate RADAR validator key GA; last row used',
			'Duplicate StellarAtlas validator key GA; last row used'
		]);
		expect(result.value.validators).toHaveLength(1);
		expect(result.value.validators[0]).toMatchObject({
			comparisonStatus: 'field_mismatch',
			fieldMismatches: [
				{
					field: 'name',
					sourceValue: 'last-radar',
					stellarAtlasValue: 'last-atlas'
				}
			]
		});
	});
});

function createRadarSnapshot(
	overrides: Partial<RadarNetworkSnapshotDTO> = {}
): RadarNetworkSnapshotDTO {
	return {
		contentHashSha256: 'fixture-hash',
		endpointUrl: 'https://radar.withobsrvr.com/api/v1',
		fetchedAt: '2026-07-03T14:00:00.000Z',
		latestLedger: '63311161',
		networkId: 'public',
		networkName: 'Public Stellar Network',
		networkTime: '2026-07-03T13:59:00.000Z',
		nodes: [],
		organizations: [],
		sourceId: 'withobsrvr-radar',
		warnings: [],
		...overrides
	};
}

function createRadarNode(
	overrides: Partial<RadarNetworkNodeDTO> = {}
): RadarNetworkNodeDTO {
	return {
		active: true,
		activeInScp: true,
		alias: null,
		connectivityError: false,
		historyArchiveHasError: false,
		historyUrl: 'https://history.example.com',
		homeDomain: 'example.com',
		host: 'validator.example.com',
		index: 1,
		isFullValidator: true,
		isValidating: false,
		isValidator: false,
		lag: null,
		name: 'Validator',
		organizationId: 'org-a',
		publicKey: 'GA',
		quorumSetHashKey: 'hash-a',
		stellarCoreVersionBehind: false,
		versionStr: '25.0.0',
		...overrides
	};
}

function createRadarOrganization(
	overrides: Partial<RadarNetworkOrganizationDTO> = {}
): RadarNetworkOrganizationDTO {
	return {
		homeDomain: 'example.com',
		horizonUrl: null,
		id: 'org-a',
		name: 'Example Org',
		tomlState: 'Ok',
		url: 'https://example.com',
		validators: ['GA'],
		...overrides
	};
}

function createStellarAtlasValidators(
	rows: readonly CrossCheckValidatorDTO[]
): CrossCheckValidatorsDTO {
	return {
		comparisonStatus: 'not_compared',
		count: rows.length,
		evidenceSelection:
			'latest_network_snapshot_validator_or_validating_or_active_in_scp',
		generatedAt: '2026-07-03T14:05:00.000Z',
		limit: 100,
		probe: 'not_run',
		totalEligibleCount: rows.length,
		validators: rows
	};
}

function createValidatorRow(
	overrides: Partial<CrossCheckValidatorEvidenceDTO> = {}
): CrossCheckValidatorDTO {
	const stellarAtlas = createValidatorEvidence(overrides);
	return {
		comparisonStatus: 'not_compared',
		publicKey: stellarAtlas.publicKey,
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas
	};
}

function createValidatorEvidence(
	overrides: Partial<CrossCheckValidatorEvidenceDTO> = {}
): CrossCheckValidatorEvidenceDTO {
	return {
		active: true,
		activeInScp: true,
		alias: null,
		connectivityError: false,
		historyArchiveHasError: false,
		historyUrl: 'https://history.example.com',
		homeDomain: 'example.com',
		host: 'validator.example.com',
		inclusionReasons: ['is_validator'],
		index: 1,
		isFullValidator: true,
		isValidating: false,
		isValidator: false,
		lag: null,
		name: 'Validator',
		organizationId: 'org-a',
		publicKey: 'GA',
		quorumSetHashKey: 'hash-a',
		stellarCoreVersionBehind: false,
		validatorEvidenceStatus: 'validator_identity_observed',
		versionStr: '25.0.0',
		...overrides
	};
}

function createStellarAtlasOrganizations(
	rows: readonly CrossCheckOrganizationDTO[]
): CrossCheckOrganizationsDTO {
	return {
		comparisonStatus: 'not_compared',
		count: rows.length,
		evidenceSelection: 'latest_network_snapshot_active_organizations',
		generatedAt: '2026-07-03T14:10:00.000Z',
		limit: 100,
		organizations: rows,
		probe: 'not_run',
		totalEligibleCount: rows.length
	};
}

function createOrganizationRow(
	overrides: Partial<CrossCheckOrganizationEvidenceDTO> = {}
): CrossCheckOrganizationDTO {
	const stellarAtlas = createOrganizationEvidence(overrides);
	return {
		comparisonStatus: 'not_compared',
		organizationId: stellarAtlas.organizationId,
		radarComparison: {
			comparisonStatus: 'not_compared',
			probe: 'not_run',
			sourceId: 'withobsrvr-radar'
		},
		stellarAtlas
	};
}

function createOrganizationEvidence(
	overrides: Partial<CrossCheckOrganizationEvidenceDTO> = {}
): CrossCheckOrganizationEvidenceDTO {
	const validatorPublicKeys = overrides.validatorPublicKeys ?? ['GA'];
	return {
		dateDiscovered: '2026-07-03T00:00:00.000Z',
		dba: null,
		description: null,
		github: null,
		has24HourStats: false,
		has30DayStats: false,
		hasReliableUptime: false,
		homeDomain: 'example.com',
		horizonUrl: null,
		id: overrides.organizationId ?? 'org-a',
		keybase: null,
		name: 'Example Org',
		officialEmail: null,
		organizationEvidenceStatus: 'organization_snapshot_observed',
		organizationId: overrides.organizationId ?? 'org-a',
		phoneNumber: null,
		physicalAddress: null,
		subQuorum24HoursAvailability: 0,
		subQuorum30DaysAvailability: 0,
		subQuorumAvailable: false,
		tomlEvidenceStatus: 'toml_ok',
		tomlState: 'Ok',
		twitter: null,
		url: 'https://example.com',
		validatorPublicKeyCount: validatorPublicKeys.length,
		validatorPublicKeys,
		...overrides
	};
}
