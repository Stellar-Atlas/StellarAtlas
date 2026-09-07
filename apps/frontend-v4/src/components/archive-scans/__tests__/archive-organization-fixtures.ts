import type { PublicNode } from '@api/types';
import type { ArchiveSource } from '../archive-inventory-model';

export function archiveSource(
	url: string,
	verified = 1,
	expected: number | null = 10
): ArchiveSource {
	return {
		archiveUrl: url,
		archiveUrlIdentity: url,
		currentLedger: expected === null ? null : expected * 64 - 1,
		latestCheckpointLedger: null,
		latestDiscoveredCheckpointLedger: null,
		durableVerifiedCheckpointProofs: verified,
		archiveEvidenceFailures: 0,
		mismatchCheckpointProofs: 0,
		activeObjectChecks: 0,
		notEvaluableCheckpointProofs: 0,
		objectCompleteCheckpointProofs: 0,
		observedAt: '2026-09-07T12:00:00Z',
		pendingCheckpointProofs: 0,
		rootObjectStatus: 'verified',
		rootFailureChannel: null,
		scannerIssueFailures: 0,
		source: 'history-scanner',
		stateStatus: 'available',
		stateUrl: url + '/.well-known/stellar-history.json',
		totalCheckpointProofs: verified,
		unclassifiedFailures: 0,
		verifiedCheckpointProofs: verified
	};
}

export function advertiser(
	historyUrl: string,
	organizationId: string | null,
	name = 'Validator'
): PublicNode {
	return {
		publicKey: name + historyUrl,
		name,
		alias: null,
		historyUrl,
		organizationId,
		homeDomain: null,
		isValidator: true,
		ip: '127.0.0.1',
		port: 11625,
		host: null,
		ledgerVersion: null,
		overlayVersion: null,
		overlayMinVersion: null,
		versionStr: null,
		quorumSet: null,
		quorumSetHashKey: null,
		active: true,
		activeInScp: true,
		geoData: null,
		statistics: {
			active30DaysPercentage: 0,
			overLoaded30DaysPercentage: 0,
			validating30DaysPercentage: 0,
			active24HoursPercentage: 0,
			overLoaded24HoursPercentage: 0,
			validating24HoursPercentage: 0,
			has30DayStats: false,
			has24HourStats: false
		},
		dateDiscovered: '2026-09-07T12:00:00Z',
		dateUpdated: '2026-09-07T12:00:00Z',
		overLoaded: false,
		isFullValidator: true,
		isValidating: true,
		index: 0,
		isp: null,
		historyArchiveHasError: false,
		connectivityError: false,
		stellarCoreVersionBehind: false,
		lag: null
	};
}
