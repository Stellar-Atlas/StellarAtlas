import type {
	PublicHistoryArchiveEvidence,
	PublicHistoryArchiveObject,
	PublicHistoryArchiveObjectType,
	PublicKnownArchiveEvidence as PublicKnownArchiveEvidenceDTO,
	PublicKnownArchiveRemoteFailure
} from '../api/archive-evidence-types';
import type { ArchiveHealthState } from './history-archive-health';

export const archiveEvidencePageLimit = 10;
export const archiveEvidenceCopyLimit = 10;

export const archiveObjectTypes = [
	'history-archive-state',
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp',
	'bucket'
] as const satisfies readonly PublicHistoryArchiveObjectType[];

export type PublicKnownArchiveEvidence = PublicKnownArchiveEvidenceDTO;

export function toKnownArchiveEvidence(
	evidence: PublicHistoryArchiveEvidence
): PublicKnownArchiveEvidence {
	const nodePublicKeys = Array.from(new Set(evidence.root.nodePublicKeys));
	return {
		eventPage: evidence.eventPage,
		generatedAt: evidence.generatedAt,
		nodePublicKeys,
		objectPage: evidence.objectPage,
		remoteFailures: evidence.remoteFailures,
		roots: [evidence.root],
		totals: {
			archiveRoots: 1,
			checkpoints: evidence.root.checkpoints,
			nodes: nodePublicKeys.length,
			objects: evidence.root.objects
		},
		workerIssues: evidence.workerIssues
	};
}

export type PublicKnownArchiveVerifiedCopy =
	PublicKnownArchiveRemoteFailure['sameOrganizationVerifiedCopies']['copies'][number];

export type KnownArchiveEvidenceTab =
	'failures' | 'work' | 'verified' | 'repair' | 'summary' | 'activity' | 'raw';

export const knownArchiveEvidenceTabs: readonly {
	readonly label: string;
	readonly value: KnownArchiveEvidenceTab;
}[] = [
	{ label: 'Failures', value: 'failures' },
	{ label: 'Current work', value: 'work' },
	{ label: 'Verified files', value: 'verified' },
	{ label: 'Repair / download', value: 'repair' },
	{ label: 'Summary', value: 'summary' },
	{ label: 'Activity', value: 'activity' },
	{ label: 'Raw response', value: 'raw' }
];

export function assessKnownArchiveEvidence(
	evidence: PublicKnownArchiveEvidence | null
): ArchiveHealthState {
	if (evidence === null) return 'unknown';
	const { checkpoints, objects } = evidence.totals;
	if (
		objects.remoteFailureObjects > 0 ||
		checkpoints.mismatchedCheckpoints > 0
	) {
		return 'remote_failure';
	}
	if (objects.workerIssueObjects > 0) return 'scanner_issue';
	if (objects.activeObjects > 0) return 'checking';
	if (objects.pendingObjects > 0 || checkpoints.pendingCheckpoints > 0) {
		return 'waiting';
	}
	if (
		objects.totalObjects > 0 &&
		objects.verifiedObjects === objects.totalObjects &&
		checkpoints.notEvaluableCheckpoints === 0
	) {
		return 'verified';
	}
	return 'unknown';
}

export function formatArchiveObjectType(
	value: PublicHistoryArchiveObjectType
): string {
	if (value === 'history-archive-state') return 'Archive state';
	if (value === 'checkpoint-state') return 'Checkpoint state';
	if (value === 'scp') return 'SCP';
	return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatArchiveRoot(value: string): string {
	try {
		const url = new URL(value);
		const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
		return `${url.host}${path}`;
	} catch {
		return value;
	}
}

export function getArchiveObjectLabel(
	object: PublicHistoryArchiveObject
): string {
	if (object.bucketHash !== null) return shortIdentifier(object.bucketHash);
	if (object.checkpointLedger !== null) {
		return `Ledger ${object.checkpointLedger.toLocaleString('en-US')}`;
	}
	return object.objectKey;
}

export function getHttpUrl(value: unknown): string | null {
	if (
		typeof value !== 'string' ||
		value.length > 4096 ||
		value.trim() !== value ||
		hasControlCharacters(value)
	) {
		return null;
	}
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:' ? value : null;
	} catch {
		return null;
	}
}

export function hasControlCharacters(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

export function getVerifiedCopyObjectUrl(
	copy: PublicKnownArchiveVerifiedCopy
): string | null {
	return getHttpUrl(copy.objectUrl);
}

function shortIdentifier(value: string): string {
	if (value.length <= 18) return value;
	return `${value.slice(0, 10)}...${value.slice(-6)}`;
}
