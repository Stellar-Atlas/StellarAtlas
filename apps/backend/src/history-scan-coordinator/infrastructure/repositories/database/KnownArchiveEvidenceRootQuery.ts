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
import {
	knownArchiveEvidenceFutureCheckpointSql,
	knownArchiveEvidenceFutureObjectSql,
	knownArchiveEvidenceLatestObjectSql,
	knownArchiveEvidenceRootSql
} from './KnownArchiveEvidenceRootSql.js';

export {
	knownArchiveEvidenceFutureCheckpointSql,
	knownArchiveEvidenceFutureObjectSql,
	knownArchiveEvidenceLatestObjectSql,
	knownArchiveEvidenceRootSql
} from './KnownArchiveEvidenceRootSql.js';

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
	const archiveUrls = roots.map((root) => root.archiveUrl);
	const archiveUrlIdentities = roots.map((root) => root.archiveUrlIdentity);

	return manager.transaction('REPEATABLE READ', async (transactionManager) => {
		const rootValue: unknown = await transactionManager.query(
			knownArchiveEvidenceRootSql,
			[archiveUrls, archiveUrlIdentities]
		);
		const rows = requireRootRows(rootValue);
		if (
			rows.some((row) => (row.rollupComplete ?? row.rollupcomplete) !== true)
		) {
			throw new ArchiveEvidenceReadModelUnavailableError(
				'Archive evidence root summary is not ready'
			);
		}
		const futureObjectValue: unknown = await transactionManager.query(
			knownArchiveEvidenceFutureObjectSql,
			[archiveUrlIdentities, snapshotAt]
		);
		const futureCheckpointValue: unknown = await transactionManager.query(
			knownArchiveEvidenceFutureCheckpointSql,
			[archiveUrlIdentities, snapshotAt]
		);
		const latestValue: unknown = await transactionManager.query(
			knownArchiveEvidenceLatestObjectSql,
			[archiveUrlIdentities, snapshotAt]
		);
		const futureObjects = indexRowsByIdentity(futureObjectValue);
		const futureCheckpoints = indexRowsByIdentity(futureCheckpointValue);
		const latestObjects = indexRowsByIdentity(latestValue);
		return rows.map((row) => {
			const identity = rootIdentity(row);
			return mapRootRow(
				row,
				futureObjects.get(identity),
				futureCheckpoints.get(identity),
				latestObjects.get(identity)
			);
		});
	});
}

function indexRowsByIdentity(value: unknown): ReadonlyMap<string, RootRow> {
	return new Map(
		requireRootRows(value).map((row) => [rootIdentity(row), row] as const)
	);
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
	row: RootRow,
	futureObjects: RootRow | undefined,
	futureCheckpoints: RootRow | undefined,
	latestObject: RootRow | undefined
): Omit<KnownArchiveRootReadModel, 'scannerOwnedState'> {
	return {
		archiveUrl: requireString(row.archiveUrl ?? row.archiveurl, 'archiveUrl'),
		archiveUrlIdentity: rootIdentity(row),
		checkpoints: mapCheckpointCounts(row, futureCheckpoints),
		latestObjectAt: nullableDate(
			latestObject?.latestObjectAt ?? latestObject?.latestobjectat
		),
		objects: mapObjectCounts(row, futureObjects)
	};
}

function mapObjectCounts(
	row: RootRow,
	future: RootRow | undefined
): KnownArchiveObjectCountsV1 {
	return {
		activeObjects: snapshotNumberField(
			row.activeObjects ?? row.activeobjects,
			future?.activeObjects ?? future?.activeobjects,
			'activeObjects'
		),
		bucketObjects: snapshotNumberField(
			row.bucketObjects ?? row.bucketobjects,
			future?.bucketObjects ?? future?.bucketobjects,
			'bucketObjects'
		),
		pendingObjects: snapshotNumberField(
			row.pendingObjects ?? row.pendingobjects,
			future?.pendingObjects ?? future?.pendingobjects,
			'pendingObjects'
		),
		remoteFailureObjects: snapshotNumberField(
			row.remoteFailureObjects ?? row.remotefailureobjects,
			future?.remoteFailureObjects ?? future?.remotefailureobjects,
			'remoteFailureObjects'
		),
		totalObjects: snapshotNumberField(
			row.totalObjects ?? row.totalobjects,
			future?.totalObjects ?? future?.totalobjects,
			'totalObjects'
		),
		verifiedBucketObjects: snapshotNumberField(
			row.verifiedBucketObjects ?? row.verifiedbucketobjects,
			future?.verifiedBucketObjects ?? future?.verifiedbucketobjects,
			'verifiedBucketObjects'
		),
		verifiedObjects: snapshotNumberField(
			row.verifiedObjects ?? row.verifiedobjects,
			future?.verifiedObjects ?? future?.verifiedobjects,
			'verifiedObjects'
		),
		workerIssueObjects: snapshotNumberField(
			row.workerIssueObjects ?? row.workerissueobjects,
			future?.workerIssueObjects ?? future?.workerissueobjects,
			'workerIssueObjects'
		)
	};
}

function mapCheckpointCounts(
	row: RootRow,
	future: RootRow | undefined
): KnownArchiveCheckpointCountsV1 {
	return {
		mismatchedCheckpoints: snapshotNumberField(
			row.mismatchedCheckpoints ?? row.mismatchedcheckpoints,
			future?.mismatchedCheckpoints ?? future?.mismatchedcheckpoints,
			'mismatchedCheckpoints'
		),
		notEvaluableCheckpoints: snapshotNumberField(
			row.notEvaluableCheckpoints ?? row.notevaluablecheckpoints,
			future?.notEvaluableCheckpoints ?? future?.notevaluablecheckpoints,
			'notEvaluableCheckpoints'
		),
		pendingCheckpoints: snapshotNumberField(
			row.pendingCheckpoints ?? row.pendingcheckpoints,
			future?.pendingCheckpoints ?? future?.pendingcheckpoints,
			'pendingCheckpoints'
		),
		totalCheckpoints: snapshotNumberField(
			row.totalCheckpoints ?? row.totalcheckpoints,
			future?.totalCheckpoints ?? future?.totalcheckpoints,
			'totalCheckpoints'
		),
		verifiedCheckpoints: snapshotNumberField(
			row.verifiedCheckpoints ?? row.verifiedcheckpoints,
			future?.verifiedCheckpoints ?? future?.verifiedcheckpoints,
			'verifiedCheckpoints'
		)
	};
}

function snapshotNumberField(
	value: NumericValue | undefined,
	futureValue: NumericValue | undefined,
	field: string
): number {
	return Math.max(
		requireNumber(value ?? 0, field) -
			requireNumber(futureValue ?? 0, `future ${field}`),
		0
	);
}

function rootIdentity(row: RootRow): string {
	return requireString(
		row.archiveUrlIdentity ?? row.archiveurlidentity,
		'archiveUrlIdentity'
	);
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
