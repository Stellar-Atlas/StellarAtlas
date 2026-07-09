import type {
	PublicHistoryArchiveObject,
	PublicHistoryArchiveObjectSummary,
	PublicStatusLevel
} from '@api/types';
import { formatInteger } from '@format/formatters';
import { getArchiveObjectDisplayStatus } from '@components/archive-scans/history-archive-object-table';
import {
	checkpointProofIsComplete,
	getPendingBucketCheckCount
} from '@domain/history-archive-proof';

export type ArchiveHealthTab =
	| 'attention'
	| 'active'
	| 'verified'
	| 'pending'
	| 'state'
	| 'activity'
	| 'raw';

export type ArchiveHealthTabCounts = Readonly<Record<ArchiveHealthTab, number>>;

export function getObjectsForArchiveHealthTab(
	objects: readonly PublicHistoryArchiveObject[],
	generatedAt: string,
	tab: ArchiveHealthTab
): readonly PublicHistoryArchiveObject[] {
	if (!isArchiveObjectTableTab(tab)) return [];
	return objects.filter((object) => {
		const status = getArchiveObjectDisplayStatus(object, generatedAt);
		if (tab === 'attention') {
			return (
				status === 'failed' ||
				status === 'delayed' ||
				(object.objectType === 'history-archive-state' && status !== 'verified')
			);
		}
		if (tab === 'active') return status === 'scanning' || status === 'delayed';
		return status === tab;
	});
}

export function countArchiveHealthTabs(
	objects: readonly PublicHistoryArchiveObject[],
	generatedAt: string
): ArchiveHealthTabCounts {
	const counts: Record<ArchiveHealthTab, number> = {
		attention: 0,
		active: 0,
		verified: 0,
		pending: 0,
		state: 0,
		activity: 0,
		raw: 0
	};

	for (const object of objects) {
		const status = getArchiveObjectDisplayStatus(object, generatedAt);
		if (
			status === 'failed' ||
			status === 'delayed' ||
			(object.objectType === 'history-archive-state' && status !== 'verified')
		) {
			counts.attention += 1;
		}
		if (status === 'scanning' || status === 'delayed') counts.active += 1;
		if (status === 'verified') counts.verified += 1;
		if (status === 'pending') counts.pending += 1;
	}

	return counts;
}

export function isArchiveObjectTableTab(tab: ArchiveHealthTab): boolean {
	return (
		tab === 'attention' ||
		tab === 'active' ||
		tab === 'verified' ||
		tab === 'pending'
	);
}

export function getArchivePanelStatus(
	summary: PublicHistoryArchiveObjectSummary | null
): PublicStatusLevel {
	if (!summary) return 'unavailable';
	if (summary.failedObjects > 0) return 'degraded';
	if (!checkpointProofIsComplete(summary)) return 'degraded';
	return 'ok';
}

export function getArchivePanelStatusText(
	summary: PublicHistoryArchiveObjectSummary | null
): string {
	if (!summary) return 'unchecked';
	if (summary.failedObjects > 0) {
		return `${formatInteger(summary.failedObjects)} remote failures`;
	}
	if (!checkpointProofIsComplete(summary)) {
		if (getPendingBucketCheckCount(summary) > 0) {
			return 'waiting for bucket checks';
		}
		return 'checkpoint proof pending';
	}
	return `${formatInteger(
		summary.checkpoints.categoryConsistentArchiveCheckpoints
	)} checkpoint proofs`;
}

export function getCheckpointProofWaitText(
	summary: PublicHistoryArchiveObjectSummary
): string {
	const pendingBuckets = getPendingBucketCheckCount(summary);
	if (
		summary.checkpoints.categoryConsistencyNotEvaluatedCheckpoints > 0 &&
		pendingBuckets > 0
	) {
		return `No failed archive files are visible in this snapshot. Checkpoint proof is waiting on ${formatInteger(pendingBuckets)} bucket copy checks.`;
	}

	return 'No failed archive files are visible in this snapshot. Checkpoint proof is still collecting cross-file evidence.';
}

export function formatArchiveHealthTabLabel(
	label: string,
	tab: ArchiveHealthTab,
	counts: ArchiveHealthTabCounts
): string {
	if (!isArchiveObjectTableTab(tab)) return label;
	return `${label} (${formatInteger(counts[tab])})`;
}

export const archiveHealthTabs: readonly {
	readonly label: string;
	readonly value: ArchiveHealthTab;
}[] = [
	{ label: 'Needs attention', value: 'attention' },
	{ label: 'Checking now', value: 'active' },
	{ label: 'Checks passed', value: 'verified' },
	{ label: 'Waiting', value: 'pending' },
	{ label: 'Archive state', value: 'state' },
	{ label: 'Activity', value: 'activity' },
	{ label: 'Raw evidence', value: 'raw' }
];
