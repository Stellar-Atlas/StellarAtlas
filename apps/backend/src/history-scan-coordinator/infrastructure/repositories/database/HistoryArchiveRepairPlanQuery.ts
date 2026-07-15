import type { EntityManager } from 'typeorm';
import type {
	HistoryArchiveRepairPlanSummary,
	HistoryArchiveVerifiedBucketSource
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { getHistoryArchiveObjectHostThrottles } from './HistoryArchiveObjectHostThrottleSummaryQuery.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

const maxBucketHashes = 500;
const maxSourcesPerBucket = 5;
const bucketHashPattern = /^[0-9a-f]{64}$/;

type RepairPlanSummaryRow = {
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly failedCheckpointProofs?: NumericValue;
	readonly failedcheckpointproofs?: NumericValue;
	readonly objectRollupComplete?: boolean;
	readonly objectrollupcomplete?: boolean;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly proofRollupComplete?: boolean;
	readonly proofrollupcomplete?: boolean;
	readonly totalObjects?: NumericValue;
	readonly totalobjects?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
};

type VerifiedBucketSourceRow = {
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly bucketHash?: string;
	readonly buckethash?: string;
	readonly objectUrl?: string;
	readonly objecturl?: string;
	readonly verifiedAt?: Date | string | null;
	readonly verifiedat?: Date | string | null;
};

export async function getHistoryArchiveRepairPlanSummary(
	manager: EntityManager,
	archiveUrlIdentity: string
): Promise<HistoryArchiveRepairPlanSummary> {
	const [summaryRows, hostThrottles] = await Promise.all([
		manager.query(historyArchiveRepairPlanSummarySql, [
			archiveUrlIdentity
		]) as Promise<readonly RepairPlanSummaryRow[]>,
		getHistoryArchiveObjectHostThrottles(manager, archiveUrlIdentity)
	]);
	const row = summaryRows[0];
	if (
		(row?.objectRollupComplete ?? row?.objectrollupcomplete) !== true ||
		(row?.proofRollupComplete ?? row?.proofrollupcomplete) !== true
	) {
		throw new Error('Archive repair plan evidence rollups are not ready');
	}

	const activeObjects = numberField(row, 'activeObjects');
	const pendingObjects = numberField(row, 'pendingObjects');
	const totalObjects = numberField(row, 'totalObjects');
	const verifiedObjects = numberField(row, 'verifiedObjects');
	const failedObjects =
		totalObjects - activeObjects - pendingObjects - verifiedObjects;
	if (failedObjects < 0) {
		throw new Error(
			'Archive repair plan object rollup counts are inconsistent'
		);
	}

	return {
		activeObjects,
		failedCheckpointProofs: numberField(row, 'failedCheckpointProofs'),
		failedObjects,
		hostThrottles,
		pendingObjects,
		verifiedObjects
	};
}

export async function findVerifiedHistoryArchiveBucketSources(
	manager: EntityManager,
	bucketHashes: readonly string[],
	limitPerHash: number
): Promise<readonly HistoryArchiveVerifiedBucketSource[]> {
	const normalizedHashes = Array.from(
		new Set(
			bucketHashes
				.map((bucketHash) => bucketHash.trim().toLowerCase())
				.filter((bucketHash) => bucketHashPattern.test(bucketHash))
		)
	).slice(0, maxBucketHashes);
	if (normalizedHashes.length === 0) return [];

	const rows = (await manager.query(historyArchiveVerifiedBucketSourcesSql, [
		normalizedHashes,
		normalizeSourceLimit(limitPerHash)
	])) as readonly VerifiedBucketSourceRow[];

	return rows.map(mapVerifiedBucketSource);
}

function numberField(
	row: RepairPlanSummaryRow | undefined,
	field:
		| 'activeObjects'
		| 'failedCheckpointProofs'
		| 'pendingObjects'
		| 'totalObjects'
		| 'verifiedObjects'
): number {
	if (field === 'activeObjects') {
		return requireNumber(
			row?.activeObjects ?? row?.activeobjects,
			'activeObjects'
		);
	}
	if (field === 'failedCheckpointProofs') {
		return requireNumber(
			row?.failedCheckpointProofs ?? row?.failedcheckpointproofs,
			'failedCheckpointProofs'
		);
	}
	if (field === 'pendingObjects') {
		return requireNumber(
			row?.pendingObjects ?? row?.pendingobjects,
			'pendingObjects'
		);
	}
	if (field === 'totalObjects') {
		return requireNumber(
			row?.totalObjects ?? row?.totalobjects,
			'totalObjects'
		);
	}
	return requireNumber(
		row?.verifiedObjects ?? row?.verifiedobjects,
		'verifiedObjects'
	);
}

function normalizeSourceLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 1;
	return Math.min(limit, maxSourcesPerBucket);
}

function mapVerifiedBucketSource(
	row: VerifiedBucketSourceRow
): HistoryArchiveVerifiedBucketSource {
	return {
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		bucketHash: requireBucketHash(row.bucketHash ?? row.buckethash),
		objectUrl: requireString(row.objectUrl ?? row.objecturl, 'objectUrl'),
		verifiedAt: nullableDate(row.verifiedAt ?? row.verifiedat)
	};
}

function requireBucketHash(value: string | undefined): string {
	const bucketHash = requireString(value, 'bucketHash').toLowerCase();
	if (bucketHashPattern.test(bucketHash)) return bucketHash;
	throw new Error('Archive bucket source row has invalid bucketHash');
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Archive bucket source row is missing ${field}`);
}

function nullableDate(value: Date | string | null | undefined): Date | null {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isNaN(date.getTime())) return date;
	throw new Error('Archive bucket source row has invalid verifiedAt');
}

export const historyArchiveRepairPlanSummarySql = `
	select
		coalesce(object_summary."totalObjects", 0) as "totalObjects",
		coalesce(object_summary."pendingObjects", 0) as "pendingObjects",
		coalesce(object_summary."activeObjects", 0) as "activeObjects",
		coalesce(object_summary."verifiedObjects", 0) as "verifiedObjects",
		coalesce(proof_summary."mismatchCheckpointProofs", 0)
			as "failedCheckpointProofs",
		coalesce((
			select "complete"
			from history_archive_evidence_root_summary_progress
			where id = 1
		), false) as "objectRollupComplete",
		coalesce((
			select "complete"
			from history_archive_checkpoint_proof_rollup_progress
			where id = 1
		), false) as "proofRollupComplete"
	from (values ($1::text)) requested("archiveUrlIdentity")
	left join history_archive_evidence_root_summary object_summary
		on object_summary."archiveUrlIdentity" = requested."archiveUrlIdentity"
	left join history_archive_checkpoint_proof_rollup proof_summary
		on proof_summary."archiveUrlIdentity" = requested."archiveUrlIdentity"
`;

export const historyArchiveVerifiedBucketSourcesSql = `
	select
		requested."bucketHash",
		source."archiveUrl",
		source."archiveUrlIdentity",
		source."objectUrl",
		source."verifiedAt"
	from unnest($1::text[]) with ordinality
		as requested("bucketHash", "requestOrder")
	cross join lateral (
		select
			archive_object.id,
			archive_object."archiveUrl",
			archive_object."archiveUrlIdentity",
			archive_object."objectUrl",
			archive_object."updatedAt",
			archive_object."verifiedAt"
		from history_archive_object_queue archive_object
		where archive_object."objectType" = 'bucket'
			and archive_object."objectKey" = 'bucket:' || requested."bucketHash"
			and archive_object.status = 'verified'
			and archive_object."verificationFacts" #>>
				'{bucketObject,expectedBucketHash}' = requested."bucketHash"
			and archive_object."verificationFacts" #>>
				'{bucketObject,matched}' = 'true'
			and archive_object."verificationFacts" #>>
				'{content,algorithm}' = 'sha256'
			and archive_object."verificationFacts" #>>
				'{content,digest}' = requested."bucketHash"
			and archive_object."verificationFacts" #>>
				'{content,representation}' = 'uncompressed-xdr'
		order by archive_object."archiveUrlIdentity" asc,
			archive_object."updatedAt" desc,
			archive_object.id asc
		limit $2::integer
	) source
	order by requested."requestOrder" asc,
		source."archiveUrlIdentity" asc,
		source."updatedAt" desc,
		source.id asc
`;
