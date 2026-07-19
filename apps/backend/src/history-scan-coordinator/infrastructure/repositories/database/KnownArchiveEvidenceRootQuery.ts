import type { EntityManager } from 'typeorm';
import { ArchiveEvidenceReadModelUnavailableError } from '../../../domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';
import type {
	KnownArchiveCheckpointCountsV1,
	KnownArchiveObjectCountsV1
} from 'shared';
import type {
	KnownArchiveRootReadModel,
	KnownArchiveRootScope
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

type RootRow = {
	readonly archiveUrl?: string;
	readonly archiveurl?: string;
	readonly archiveUrlIdentity?: string;
	readonly archiveurlidentity?: string;
	readonly activeObjects?: NumericValue;
	readonly activeobjects?: NumericValue;
	readonly bucketObjects?: NumericValue;
	readonly bucketobjects?: NumericValue;
	readonly latestObjectAt?: Date | string | null;
	readonly latestobjectat?: Date | string | null;
	readonly mismatchedCheckpoints?: NumericValue;
	readonly mismatchedcheckpoints?: NumericValue;
	readonly notEvaluableCheckpoints?: NumericValue;
	readonly notevaluablecheckpoints?: NumericValue;
	readonly pendingCheckpoints?: NumericValue;
	readonly pendingcheckpoints?: NumericValue;
	readonly pendingObjects?: NumericValue;
	readonly pendingobjects?: NumericValue;
	readonly remoteFailureObjects?: NumericValue;
	readonly remotefailureobjects?: NumericValue;
	readonly rollupComplete?: boolean;
	readonly rollupcomplete?: boolean;
	readonly totalCheckpoints?: NumericValue;
	readonly totalcheckpoints?: NumericValue;
	readonly totalObjects?: NumericValue;
	readonly totalobjects?: NumericValue;
	readonly verifiedBucketObjects?: NumericValue;
	readonly verifiedbucketobjects?: NumericValue;
	readonly verifiedCheckpoints?: NumericValue;
	readonly verifiedcheckpoints?: NumericValue;
	readonly verifiedObjects?: NumericValue;
	readonly verifiedobjects?: NumericValue;
	readonly workerIssueObjects?: NumericValue;
	readonly workerissueobjects?: NumericValue;
};

export async function findKnownArchiveEvidenceRoots(
	manager: EntityManager,
	roots: readonly KnownArchiveRootScope[],
	snapshotAt: Date
): Promise<readonly Omit<KnownArchiveRootReadModel, 'scannerOwnedState'>[]> {
	if (roots.length === 0) return [];

	const value: unknown = await manager.query(knownArchiveEvidenceRootSql, [
		roots.map((root) => root.archiveUrl),
		roots.map((root) => root.archiveUrlIdentity),
		snapshotAt
	]);
	const rows = requireRootRows(value);
	if (rows.some((row) => (row.rollupComplete ?? row.rollupcomplete) !== true)) {
		throw new ArchiveEvidenceReadModelUnavailableError(
			'Archive evidence root summary is not ready'
		);
	}

	return rows.map(mapRootRow);
}

function requireRootRows(value: unknown): readonly RootRow[] {
	if (!Array.isArray(value)) {
		throw new Error('Known archive evidence root query did not return rows');
	}
	const values: unknown[] = value;
	const rows: RootRow[] = [];
	for (const item of values) {
		if (!isRootRow(item)) {
			throw new Error(
				'Known archive evidence root query returned an invalid row'
			);
		}
		rows.push(item);
	}
	return rows;
}

function isRootRow(value: unknown): value is RootRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapRootRow(
	row: RootRow
): Omit<KnownArchiveRootReadModel, 'scannerOwnedState'> {
	return {
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: requireString(
			row.archiveUrlIdentity ?? row.archiveurlidentity,
			'archiveUrlIdentity'
		),
		checkpoints: mapCheckpointCounts(row),
		latestObjectAt: nullableDate(row.latestObjectAt ?? row.latestobjectat),
		objects: mapObjectCounts(row)
	};
}

function mapObjectCounts(row: RootRow): KnownArchiveObjectCountsV1 {
	return {
		activeObjects: numberField(
			row.activeObjects ?? row.activeobjects,
			'activeObjects'
		),
		bucketObjects: numberField(
			row.bucketObjects ?? row.bucketobjects,
			'bucketObjects'
		),
		pendingObjects: numberField(
			row.pendingObjects ?? row.pendingobjects,
			'pendingObjects'
		),
		remoteFailureObjects: numberField(
			row.remoteFailureObjects ?? row.remotefailureobjects,
			'remoteFailureObjects'
		),
		totalObjects: numberField(
			row.totalObjects ?? row.totalobjects,
			'totalObjects'
		),
		verifiedBucketObjects: numberField(
			row.verifiedBucketObjects ?? row.verifiedbucketobjects,
			'verifiedBucketObjects'
		),
		verifiedObjects: numberField(
			row.verifiedObjects ?? row.verifiedobjects,
			'verifiedObjects'
		),
		workerIssueObjects: numberField(
			row.workerIssueObjects ?? row.workerissueobjects,
			'workerIssueObjects'
		)
	};
}

function mapCheckpointCounts(row: RootRow): KnownArchiveCheckpointCountsV1 {
	return {
		mismatchedCheckpoints: numberField(
			row.mismatchedCheckpoints ?? row.mismatchedcheckpoints,
			'mismatchedCheckpoints'
		),
		notEvaluableCheckpoints: numberField(
			row.notEvaluableCheckpoints ?? row.notevaluablecheckpoints,
			'notEvaluableCheckpoints'
		),
		pendingCheckpoints: numberField(
			row.pendingCheckpoints ?? row.pendingcheckpoints,
			'pendingCheckpoints'
		),
		totalCheckpoints: numberField(
			row.totalCheckpoints ?? row.totalcheckpoints,
			'totalCheckpoints'
		),
		verifiedCheckpoints: numberField(
			row.verifiedCheckpoints ?? row.verifiedcheckpoints,
			'verifiedCheckpoints'
		)
	};
}

function numberField(value: NumericValue | undefined, field: string): number {
	return requireNumber(value ?? 0, field);
}

function requireString(value: string | undefined, field: string): string {
	if (typeof value === 'string' && value.length > 0) return value;
	throw new Error(`Known archive evidence root row is missing ${field}`);
}

function nullableDate(value: Date | string | null | undefined): Date | null {
	if (value === null || value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(
			'Known archive evidence root row has invalid latestObjectAt'
		);
	}
	return date;
}

export const knownArchiveEvidenceRootSql = `
	with requested_roots as (
		select *
		from unnest($1::text[], $2::text[])
			as root("archiveUrl", "archiveUrlIdentity")
	),
	checkpoint_counts as (
		select
			proof."archiveUrlIdentity",
			proof."totalCheckpointProofs" as "totalCheckpoints",
			proof."verifiedCheckpointProofs" as "verifiedCheckpoints",
			proof."mismatchCheckpointProofs" as "mismatchedCheckpoints",
			proof."pendingCheckpointProofs" as "pendingCheckpoints",
			proof."notEvaluableCheckpointProofs" as "notEvaluableCheckpoints"
		from history_archive_checkpoint_proof_rollup proof
		where proof."archiveUrlIdentity" = any($2::text[])
	), future_checkpoint_counts as (
		select
			proof."archiveUrlIdentity",
			count(*) as "totalCheckpoints",
			count(*) filter (where proof.status = 'verified')
				as "verifiedCheckpoints",
			count(*) filter (where proof.status = 'mismatch')
				as "mismatchedCheckpoints",
			count(*) filter (where proof.status = 'pending')
				as "pendingCheckpoints",
			count(*) filter (where proof.status = 'not-evaluable')
				as "notEvaluableCheckpoints"
		from history_archive_checkpoint_proof proof
		where proof."archiveUrlIdentity" = any($2::text[])
			and proof."createdAt" > $3::timestamptz
		group by proof."archiveUrlIdentity"
	),
	summary_progress as materialized (
		select
			coalesce((
				select "complete" and "lastObjectId" = "cutoffObjectId"
				from history_archive_evidence_root_summary_progress
				where id = 1
			), false)
			and coalesce((
				select "complete" and "lastProofId" = "cutoffProofId"
				from history_archive_checkpoint_proof_rollup_progress
				where id = 1
			), false) as "rollupComplete"
	)
	select
		root."archiveUrl",
		root."archiveUrlIdentity",
		summary_progress."rollupComplete",
		greatest(
			coalesce(summary."totalObjects", 0) - future_objects."totalObjects",
			0
		) as "totalObjects",
		greatest(
			coalesce(summary."pendingObjects", 0) - future_objects."pendingObjects",
			0
		) as "pendingObjects",
		greatest(
			coalesce(summary."activeObjects", 0) - future_objects."activeObjects",
			0
		) as "activeObjects",
		greatest(
			coalesce(summary."verifiedObjects", 0) - future_objects."verifiedObjects",
			0
		) as "verifiedObjects",
		greatest(
			coalesce(summary."remoteFailureObjects", 0)
				- future_objects."remoteFailureObjects",
			0
		) as "remoteFailureObjects",
		greatest(
			coalesce(summary."workerIssueObjects", 0)
				- future_objects."workerIssueObjects",
			0
		) as "workerIssueObjects",
		greatest(
			coalesce(summary."bucketObjects", 0) - future_objects."bucketObjects",
			0
		) as "bucketObjects",
		greatest(
			coalesce(summary."verifiedBucketObjects", 0)
				- future_objects."verifiedBucketObjects",
			0
		) as "verifiedBucketObjects",
		latest_object."createdAt" as "latestObjectAt",
		greatest(
			coalesce(checkpoints."totalCheckpoints", 0)
				- coalesce(future_checkpoints."totalCheckpoints", 0),
			0
		) as "totalCheckpoints",
		greatest(
			coalesce(checkpoints."verifiedCheckpoints", 0)
				- coalesce(future_checkpoints."verifiedCheckpoints", 0),
			0
		) as "verifiedCheckpoints",
		greatest(
			coalesce(checkpoints."mismatchedCheckpoints", 0)
				- coalesce(future_checkpoints."mismatchedCheckpoints", 0),
			0
		)
			as "mismatchedCheckpoints",
		greatest(
			coalesce(checkpoints."pendingCheckpoints", 0)
				- coalesce(future_checkpoints."pendingCheckpoints", 0),
			0
		) as "pendingCheckpoints",
		greatest(
			coalesce(checkpoints."notEvaluableCheckpoints", 0)
				- coalesce(future_checkpoints."notEvaluableCheckpoints", 0),
			0
		)
			as "notEvaluableCheckpoints"
	from requested_roots root
	cross join summary_progress
	left join history_archive_evidence_root_summary summary
		on summary."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join checkpoint_counts checkpoints
		on checkpoints."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join future_checkpoint_counts future_checkpoints
		on future_checkpoints."archiveUrlIdentity" = root."archiveUrlIdentity"
	left join lateral (
		select archive_object."createdAt"
		from history_archive_object_queue archive_object
		where archive_object."archiveUrlIdentity" = root."archiveUrlIdentity"
			and archive_object."createdAt" <= $3::timestamptz
		order by archive_object."createdAt" desc
		limit 1
	) latest_object on true
	cross join lateral (
		select
			count(*) as "totalObjects",
			count(*) filter (where archive_object.status = 'pending')
				as "pendingObjects",
			count(*) filter (where archive_object.status = 'scanning')
				as "activeObjects",
			count(*) filter (where archive_object.status = 'verified')
				as "verifiedObjects",
			count(*) filter (
				where archive_object.status = 'failed'
					and archive_object."failureChannel" = 'archive_evidence'
			) as "remoteFailureObjects",
			count(*) filter (
				where archive_object.status = 'failed'
					and archive_object."failureChannel" = 'scanner_issue'
			) as "workerIssueObjects",
			count(*) filter (where archive_object."objectType" = 'bucket')
				as "bucketObjects",
			count(*) filter (
				where archive_object."objectType" = 'bucket'
					and archive_object.status = 'verified'
			) as "verifiedBucketObjects"
		from history_archive_object_queue archive_object
		where archive_object."archiveUrlIdentity" = root."archiveUrlIdentity"
			and archive_object."createdAt" > $3::timestamptz
	) future_objects
	order by root."archiveUrlIdentity" asc
`;
