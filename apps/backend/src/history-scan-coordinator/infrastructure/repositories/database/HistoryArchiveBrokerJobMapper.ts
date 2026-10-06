import type { HistoryArchiveObjectType } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveBrokerPriority } from '../../../domain/history-archive-object/HistoryArchiveBrokerPriority.js';

export interface HistoryArchiveBrokerJob {
	readonly executionId: string;
	readonly job: {
		readonly archiveUrl: string;
		readonly bucketHash: string | null;
		readonly checkpointLedger: number | null;
		readonly claimAttempt: number;
		readonly objectKey: string;
		readonly objectType: HistoryArchiveObjectType;
		readonly objectUrl: string;
		readonly remoteId: string;
		readonly allowListingDiscovery?: boolean;
	};
	readonly priority: HistoryArchiveBrokerPriority;
	readonly selectedOrdinal: number;
}
export interface BrokerJobRow {
	readonly allowListingDiscovery?: boolean;
	readonly archiveUrl: string;
	readonly bucketHash: string | null;
	readonly checkpointLedger: number | string | null;
	readonly claimAttempt: number | string;
	readonly dispatchToken: string;
	readonly objectKey: string;
	readonly objectType: HistoryArchiveObjectType;
	readonly objectUrl: string;
	readonly priority: number | string;
	readonly remoteId: string;
	readonly selectedOrdinal: number | string;
}
function requirePositiveInteger(value: number | string, field: string): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error(`Invalid archive broker ${field}`);
	return parsed;
}
function nullableInteger(
	value: number | string | null,
	field: string
): number | null {
	if (value === null) return null;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0)
		throw new Error(`Invalid archive broker ${field}`);
	return parsed;
}
export function requirePriority(
	value: number | string
): HistoryArchiveBrokerPriority {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (parsed !== 0 && parsed !== 1 && parsed !== 2)
		throw new Error('Invalid archive broker priority');
	return parsed;
}
function mapBrokerJob(row: BrokerJobRow): HistoryArchiveBrokerJob {
	return {
		executionId: row.dispatchToken,
		job: {
			archiveUrl: row.archiveUrl,
			bucketHash: row.bucketHash,
			checkpointLedger: nullableInteger(
				row.checkpointLedger,
				'checkpointLedger'
			),
			claimAttempt: requirePositiveInteger(row.claimAttempt, 'claimAttempt'),
			objectKey: row.objectKey,
			objectType: row.objectType,
			objectUrl: row.objectUrl,
			remoteId: row.remoteId,
			allowListingDiscovery: row.allowListingDiscovery === true
		},
		priority: requirePriority(row.priority),
		selectedOrdinal: requirePositiveInteger(
			row.selectedOrdinal,
			'selectedOrdinal'
		)
	};
}

export function compareHistoryArchiveBrokerJobs(
	left: HistoryArchiveBrokerJob,
	right: HistoryArchiveBrokerJob
): number {
	// The database ordinal includes first-pass precedence as well as priority.
	// Re-sorting by numeric priority would move allowed recoveries ahead of fresh work.
	if (left.selectedOrdinal !== right.selectedOrdinal)
		return left.selectedOrdinal - right.selectedOrdinal;
	if (left.priority !== right.priority) return left.priority - right.priority;
	return left.executionId < right.executionId
		? -1
		: left.executionId > right.executionId
			? 1
			: 0;
}
export function mapAndOrderBrokerJobs(
	rows: readonly BrokerJobRow[]
): readonly HistoryArchiveBrokerJob[] {
	return rows.map(mapBrokerJob).sort(compareHistoryArchiveBrokerJobs);
}
