import type {
	KnownArchiveFailurePageRequest,
	KnownArchiveObjectPageRequest,
	KnownArchiveRootReadModel
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';

type AggregateRoot = Pick<
	KnownArchiveRootReadModel,
	'archiveUrlIdentity' | 'objects'
>;

export function applyKnownArchiveObjectAggregateTotal(
	page: KnownArchiveObjectPageRequest,
	roots: readonly AggregateRoot[]
): KnownArchiveObjectPageRequest {
	if (page.snapshotTotal !== null) return page;
	const selected = selectRoots(roots, page.filters.archiveUrlIdentity);
	const total = getObjectTotal(selected, page);
	return total === null ? page : { ...page, snapshotTotal: total };
}

export function applyKnownArchiveFailureAggregateTotal(
	page: KnownArchiveFailurePageRequest,
	roots: readonly AggregateRoot[],
	kind: 'infrastructure' | 'remote'
): KnownArchiveFailurePageRequest {
	if (page.snapshotTotal !== null || page.filters.objectType !== null)
		return page;
	const selected = selectRoots(roots, page.filters.archiveUrlIdentity);
	return {
		...page,
		snapshotTotal: sumCounts(selected, (root) =>
			kind === 'remote'
				? root.objects.remoteFailureObjects
				: root.objects.workerIssueObjects
		)
	};
}

function getObjectTotal(
	roots: readonly AggregateRoot[],
	page: KnownArchiveObjectPageRequest
): number | null {
	const { objectType, status } = page.filters;
	if (objectType === null) {
		if (status === null) {
			return sumCounts(roots, (root) => root.objects.totalObjects);
		}
		if (status === 'pending') {
			return sumCounts(roots, (root) => root.objects.pendingObjects);
		}
		if (status === 'scanning') {
			return sumCounts(roots, (root) => root.objects.activeObjects);
		}
		if (status === 'verified') {
			return sumCounts(roots, (root) => root.objects.verifiedObjects);
		}
		return sumExactFailedCounts(roots);
	}

	if (objectType !== 'bucket') return null;
	if (status === null) {
		return sumCounts(roots, (root) => root.objects.bucketObjects);
	}
	if (status === 'verified') {
		return sumCounts(roots, (root) => root.objects.verifiedBucketObjects);
	}
	return null;
}

function sumExactFailedCounts(roots: readonly AggregateRoot[]): number | null {
	let total = 0;
	for (const root of roots) {
		const classified =
			root.objects.remoteFailureObjects + root.objects.workerIssueObjects;
		const failed =
			root.objects.totalObjects -
			root.objects.pendingObjects -
			root.objects.activeObjects -
			root.objects.verifiedObjects;
		if (failed < 0 || failed !== classified) return null;
		total = safeAdd(total, failed);
	}
	return total;
}

function selectRoots(
	roots: readonly AggregateRoot[],
	archiveUrlIdentity: string | null
): readonly AggregateRoot[] {
	const unique = new Map<string, AggregateRoot>();
	for (const root of roots) {
		if (
			archiveUrlIdentity === null ||
			root.archiveUrlIdentity === archiveUrlIdentity
		) {
			unique.set(root.archiveUrlIdentity, root);
		}
	}
	return [...unique.values()];
}

function sumCounts(
	roots: readonly AggregateRoot[],
	select: (root: AggregateRoot) => number
): number {
	let total = 0;
	for (const root of roots) total = safeAdd(total, select(root));
	return total;
}

function safeAdd(total: number, value: number): number {
	const result = total + value;
	if (
		!Number.isSafeInteger(total) ||
		!Number.isSafeInteger(value) ||
		value < 0 ||
		!Number.isSafeInteger(result)
	) {
		throw new Error('Known archive evidence aggregate total is unsafe');
	}
	return result;
}
