import type {
	KnownArchiveEvidenceTab,
	PublicKnownArchiveEvidence
} from '@domain/known-archive-evidence';
import type { ArchiveEvidenceObjectQuery } from '@domain/known-archive-evidence-request';

export function getObjectQueryForTab(
	tab: KnownArchiveEvidenceTab,
	query: ArchiveEvidenceObjectQuery,
	counts?: Pick<
		PublicKnownArchiveEvidence['totals']['objects'],
		'activeObjects' | 'pendingObjects'
	>
): ArchiveEvidenceObjectQuery | null {
	if (tab === 'verified' && query.status !== 'verified') {
		return { ...query, status: 'verified' };
	}
	if (tab === 'work') {
		const preferredStatus = getPreferredWorkStatus(query.status, counts);
		if (query.status !== preferredStatus) {
			return { ...query, status: preferredStatus };
		}
	}
	return null;
}

export function getObjectRefreshQuery(
	tab: KnownArchiveEvidenceTab,
	query: ArchiveEvidenceObjectQuery,
	counts: Pick<
		PublicKnownArchiveEvidence['totals']['objects'],
		'activeObjects' | 'pendingObjects'
	>
): ArchiveEvidenceObjectQuery {
	return getObjectQueryForTab(tab, query, counts) ?? query;
}

function getPreferredWorkStatus(
	status: ArchiveEvidenceObjectQuery['status'],
	counts:
		| Pick<
				PublicKnownArchiveEvidence['totals']['objects'],
				'activeObjects' | 'pendingObjects'
		  >
		| undefined
): 'pending' | 'scanning' {
	if (counts?.pendingObjects === 0 && counts.activeObjects > 0) {
		return 'scanning';
	}
	if (counts?.activeObjects === 0 && counts.pendingObjects > 0) {
		return 'pending';
	}
	return status === 'scanning' ? 'scanning' : 'pending';
}

export function shouldLoadInitialActivityPage(
	tab: KnownArchiveEvidenceTab,
	pageLimit: number | undefined
): boolean {
	return tab === 'activity' && pageLimit === 0;
}
