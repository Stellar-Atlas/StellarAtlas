import { mock, MockProxy } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import type { NetworkV1, NodeV1, OrganizationV1 } from 'shared';
import { GetNetwork } from '@network-scan/use-cases/get-network/GetNetwork.js';
import { StellarAtlasNetworkRowsSourceAdapter } from '../StellarAtlasNetworkRowsSourceAdapter.js';

describe('StellarAtlasNetworkRowsSourceAdapter', () => {
	let getNetwork: MockProxy<GetNetwork>;
	let adapter: StellarAtlasNetworkRowsSourceAdapter;

	beforeEach(() => {
		getNetwork = mock<GetNetwork>();
		adapter = new StellarAtlasNetworkRowsSourceAdapter(
			getNetwork,
			() => new Date('2026-07-03T17:00:00.000Z')
		);
	});

	it('should map all current validator and organization rows', async () => {
		getNetwork.execute.mockResolvedValue(
			ok(
				createNetwork({
					nodes: [
						createNode({ publicKey: 'GA', isValidating: true }),
						createNode({ publicKey: 'GB', isValidator: true }),
						createNode({ publicKey: 'GC', activeInScp: true }),
						createNode({ publicKey: 'GD' })
					],
					organizations: [
						createOrganization({ id: 'org-c', name: 'Org C' }),
						createOrganization({
							id: 'org-a',
							name: 'Org A',
							validators: ['GA']
						})
					]
				})
			)
		);

		const result = await adapter.readRows();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.validators).toMatchObject({
			comparisonStatus: 'not_compared',
			count: 3,
			generatedAt: '2026-07-03T17:00:00.000Z',
			limit: 3,
			totalEligibleCount: 3
		});
		expect(
			result.value.validators.validators.map((row) => row.publicKey)
		).toEqual(['GA', 'GB', 'GC']);
		expect(result.value.organizations).toMatchObject({
			comparisonStatus: 'not_compared',
			count: 2,
			generatedAt: '2026-07-03T17:00:00.000Z',
			limit: 2,
			totalEligibleCount: 2
		});
		expect(
			result.value.organizations.organizations.map((row) => row.organizationId)
		).toEqual(['org-a', 'org-c']);
		expect(getNetwork.execute).toHaveBeenCalledWith({});
	});

	it('should propagate network read failures', async () => {
		const error = new Error('network unavailable');
		getNetwork.execute.mockResolvedValue(err(error));

		const result = await adapter.readRows();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});

	it('should return a read failure when no latest network exists', async () => {
		getNetwork.execute.mockResolvedValue(ok(null));

		const result = await adapter.readRows();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr().message).toBe(
			'No latest StellarAtlas network snapshot available'
		);
	});
});

function createNetwork(overrides: Partial<NetworkV1> = {}): NetworkV1 {
	return {
		id: 'public',
		latestLedger: '63311161',
		name: 'Public Stellar Network',
		nodes: [],
		organizations: [],
		passPhrase: 'Public Global Stellar Network ; September 2015',
		scc: [],
		statistics: {
			hasQuorumIntersection: true,
			hasSymmetricTopTier: true,
			hasTransitiveQuorumSet: true,
			minBlockingSetCountryFilteredSize: 0,
			minBlockingSetCountrySize: 0,
			minBlockingSetFilteredSize: 0,
			minBlockingSetISPFilteredSize: 0,
			minBlockingSetISPSize: 0,
			minBlockingSetOrgsFilteredSize: 0,
			minBlockingSetOrgsSize: 0,
			minBlockingSetSize: 0,
			minSplittingSetCountrySize: 0,
			minSplittingSetISPSize: 0,
			minSplittingSetOrgsSize: 0,
			minSplittingSetSize: 0,
			nrOfActiveFullValidators: 0,
			nrOfActiveOrganizations: 0,
			nrOfActiveValidators: 0,
			nrOfActiveWatchers: 0,
			nrOfConnectableNodes: 0,
			time: '2026-07-03T17:00:00.000Z',
			topTierOrgsSize: 0,
			topTierSize: 0,
			transitiveQuorumSetSize: 0
		},
		time: '2026-07-03T17:00:00.000Z',
		transitiveQuorumSet: [],
		...overrides
	};
}

function createNode(overrides: Partial<NodeV1>): NodeV1 {
	return {
		active: false,
		activeInScp: false,
		alias: null,
		connectivityError: false,
		dateDiscovered: '2026-07-03T00:00:00.000Z',
		dateUpdated: '2026-07-03T00:00:00.000Z',
		geoData: null,
		historyArchiveHasError: false,
		historyUrl: null,
		homeDomain: null,
		host: null,
		index: 0,
		ip: '127.0.0.1',
		isFullValidator: false,
		isValidating: false,
		isValidator: false,
		isp: null,
		lag: null,
		ledgerVersion: null,
		name: null,
		organizationId: null,
		overLoaded: false,
		overlayMinVersion: null,
		overlayVersion: null,
		port: 11625,
		publicKey: 'G'.padEnd(56, 'A'),
		quorumSet: null,
		quorumSetHashKey: null,
		statistics: {
			active24HoursPercentage: 0,
			active30DaysPercentage: 0,
			has24HourStats: false,
			has30DayStats: false,
			overLoaded24HoursPercentage: 0,
			overLoaded30DaysPercentage: 0,
			validating24HoursPercentage: 0,
			validating30DaysPercentage: 0
		},
		stellarCoreVersionBehind: false,
		versionStr: null,
		...overrides
	};
}

function createOrganization(
	overrides: Partial<OrganizationV1> = {}
): OrganizationV1 {
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
		id: 'org-id',
		keybase: null,
		logo: null,
		name: null,
		officialEmail: null,
		phoneNumber: null,
		physicalAddress: null,
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
