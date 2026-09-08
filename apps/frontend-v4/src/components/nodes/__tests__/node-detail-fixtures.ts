import type {
	PublicKnownNode,
	PublicNetwork,
	PublicNode,
	PublicOrganization
} from '../../../api/types';
import { advertiser } from '../../archive-scans/__tests__/archive-organization-fixtures';

export function nodeFixture(
	publicKey: string,
	overrides: Partial<PublicNode> = {}
): PublicNode {
	return {
		...advertiser('https://archive.example/History/', null, publicKey),
		publicKey,
		...overrides
	};
}
export function knownNodeFixture(node: PublicNode): PublicKnownNode {
	return {
		current: true,
		dateDiscovered: node.dateDiscovered,
		lastMeasurementAt: node.dateUpdated,
		lastSeen: node.dateUpdated,
		metadataState: 'snapshot',
		node,
		publicKey: node.publicKey,
		scope: 'current-validator',
		snapshotEndDate: null,
		snapshotStartDate: node.dateUpdated
	};
}
export function organizationFixture(id: string): PublicOrganization {
	return {
		id,
		name: id,
		dba: null,
		homeDomain: id + '.example',
		validators: [],
		dateDiscovered: '2026-09-07T12:00:00Z',
		description: null,
		github: null,
		has24HourStats: true,
		has30DayStats: true,
		hasReliableUptime: true,
		horizonUrl: null,
		keybase: null,
		logo: null,
		officialEmail: null,
		phoneNumber: null,
		physicalAddress: null,
		stellarToml: null,
		subQuorum24HoursAvailability: 100,
		subQuorum30DaysAvailability: 100,
		subQuorumAvailable: true,
		tomlState: 'Ok',
		tomlWarnings: [],
		twitter: null,
		url: null
	};
}
export function networkFixture(
	nodes: PublicNode[],
	organizations: PublicOrganization[] = []
): PublicNetwork {
	return {
		id: 'public',
		name: 'Public network',
		latestLedger: '64000000',
		nodes,
		organizations,
		passPhrase: 'Public Global Stellar Network ; September 2015',
		scope: 'current-network',
		scc: [],
		time: '2026-09-07T12:00:00Z',
		transitiveQuorumSet: [],
		statistics: {
			time: '2026-09-07T12:00:00Z',
			hasQuorumIntersection: true,
			hasSymmetricTopTier: true,
			hasTransitiveQuorumSet: true,
			minBlockingSetCountryFilteredSize: 1,
			minBlockingSetCountrySize: 1,
			minBlockingSetFilteredSize: 1,
			minBlockingSetISPFilteredSize: 1,
			minBlockingSetISPSize: 1,
			minBlockingSetOrgsFilteredSize: 1,
			minBlockingSetOrgsSize: 1,
			minBlockingSetSize: 1,
			minSplittingSetCountrySize: 1,
			minSplittingSetISPSize: 1,
			minSplittingSetOrgsSize: 1,
			minSplittingSetSize: 1,
			nrOfActiveFullValidators: 0,
			nrOfActiveOrganizations: 0,
			nrOfActiveValidators: 0,
			nrOfActiveWatchers: 0,
			nrOfConnectableNodes: 0,
			topTierOrgsSize: 0,
			topTierSize: 0,
			transitiveQuorumSetSize: 0
		}
	};
}
export const quorum = (...validators: string[]) => ({
	threshold: 1,
	validators,
	innerQuorumSets: []
});
