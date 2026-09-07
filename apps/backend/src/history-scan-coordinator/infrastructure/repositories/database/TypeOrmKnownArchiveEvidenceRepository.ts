import { injectable } from 'inversify';
import { DataSource, In, type EntityManager } from 'typeorm';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type {
	KnownArchiveEvidencePageRequest,
	KnownArchiveEvidenceQuery,
	KnownArchiveEvidenceReadModel,
	KnownArchiveEvidenceRepository
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { findKnownArchiveEvidenceRoots } from './KnownArchiveEvidenceRootQuery.js';
import { getKnownArchiveFailureSummary } from './KnownArchiveFailureSummaryCache.js';
import { emptyArchiveFailureSummary } from './KnownArchiveFailureSummaryValue.js';
import { findKnownArchiveFailurePage } from './KnownArchiveFailurePageQuery.js';
import { findKnownArchiveCopyCoverage } from './KnownArchiveCopyCoverageQuery.js';
import { findKnownArchiveObjectPage } from './KnownArchiveObjectPageQuery.js';
import { findKnownArchiveObjectEventPage } from './KnownArchiveObjectEventPageQuery.js';
import { withBoundedArchiveEvidenceRead } from './BoundedArchiveEvidenceRead.js';
import {
	applyKnownArchiveFailureAggregateTotal,
	applyKnownArchiveObjectAggregateTotal
} from './KnownArchiveEvidenceAggregateTotals.js';

@injectable()
export class TypeOrmKnownArchiveEvidenceRepository implements KnownArchiveEvidenceRepository {
	constructor(private readonly dataSource: DataSource) {}

	async findEvidence(
		query: KnownArchiveEvidenceQuery
	): Promise<KnownArchiveEvidenceReadModel> {
		if (query.roots.length === 0) {
			return {
				copyCoverage: [],
				eventPage: { events: [], total: 0 },
				objectPage: { objects: [], total: 0 },
				remoteFailures: { failures: [], total: 0 },
				roots: [],
				workerIssues: { failures: [], total: 0 }
			};
		}
		const evidence = await withBoundedArchiveEvidenceRead(
			this.dataSource,
			(manager) => readEvidenceSnapshot(manager, query)
		);
		// This cache may acquire its own connection. Never hold the request
		// transaction across refresh, including when the pool has only one slot.
		const onlyRoot = query.roots.length === 1 ? query.roots[0] : undefined;
		const rootCounts = evidence.roots[0]?.objects;
		const unresolved =
			rootCounts?.unresolvedRemoteFailureObjects ??
			(rootCounts === undefined
				? undefined
				: rootCounts.remoteFailureObjects +
					(rootCounts.retainedRemoteFailureObjects ?? 0));
		const failureSummary =
			query.includeFailureSummary === true && onlyRoot !== undefined
				? unresolved === 0
					? emptyArchiveFailureSummary(
							new Date(),
							rootCounts?.workerIssueObjects ?? 0
						)
					: await getKnownArchiveFailureSummary(
							this.dataSource,
							onlyRoot.archiveUrlIdentity
						)
				: undefined;
		return failureSummary === undefined
			? evidence
			: {
					...evidence,
					roots: evidence.roots.map((root) => ({
						...root,
						failureSummary:
							failureSummary.computedAt !== null &&
							failureSummary.remoteFailureCount !== unresolved
								? { ...failureSummary, status: 'stale' as const }
								: failureSummary
					}))
				};
	}
}

async function readEvidenceSnapshot(
	manager: EntityManager,
	query: KnownArchiveEvidenceQuery
): Promise<KnownArchiveEvidenceReadModel> {
	const archiveUrlIdentities = query.roots.map(
		(root) => root.archiveUrlIdentity
	);
	const rootRows = await findKnownArchiveEvidenceRoots(
		manager,
		query.roots,
		query.snapshotAt
	);
	const states = await manager
		.getRepository(HistoryArchiveStateSnapshot)
		.findBy({
			archiveUrlIdentity: In(archiveUrlIdentities)
		});
	const remotePage = applyKnownArchiveFailureAggregateTotal(
		query.remoteFailures,
		rootRows,
		'remote'
	);
	const workerPage = applyKnownArchiveFailureAggregateTotal(
		query.workerIssues,
		rootRows,
		'infrastructure'
	);
	const objectRequest = applyKnownArchiveObjectAggregateTotal(
		query.objectPage,
		rootRows
	);
	// One connection, sequential reads: a timeout stops the request before any
	// later page query is queued. Disabled pages never fetch a limit+1 row.
	const remoteFailures = shouldReadPage(remotePage)
		? await findKnownArchiveFailurePage(
				manager,
				archiveUrlIdentities,
				remotePage,
				'remote'
			)
		: { failures: [], total: remotePage.snapshotTotal ?? 0 };
	const workerIssues = shouldReadPage(workerPage)
		? await findKnownArchiveFailurePage(
				manager,
				archiveUrlIdentities,
				workerPage,
				'infrastructure'
			)
		: { failures: [], total: workerPage.snapshotTotal ?? 0 };
	const objectPage = shouldReadPage(objectRequest)
		? await findKnownArchiveObjectPage(
				manager,
				archiveUrlIdentities,
				objectRequest
			)
		: { objects: [], total: objectRequest.snapshotTotal ?? 0 };
	const eventPage = shouldReadPage(query.eventPage)
		? await findKnownArchiveObjectEventPage(
				manager,
				archiveUrlIdentities,
				query.eventPage
			)
		: { events: [], total: query.eventPage.snapshotTotal ?? 0 };
	const copyCoverage = await findKnownArchiveCopyCoverage(
		manager,
		remoteFailures.failures
			.slice(0, query.remoteFailures.limit)
			.map((failure) => failure.object),
		query.sameOrganizationArchiveUrlIdentities,
		query.copyLimit,
		query.snapshotAt
	);
	const statesByIdentity = new Map(
		states.map((state) => [state.archiveUrlIdentity, state])
	);
	return {
		copyCoverage,
		eventPage,
		objectPage,
		remoteFailures,
		workerIssues,
		roots: rootRows.map((root) => ({
			...root,
			scannerOwnedState: statesByIdentity.get(root.archiveUrlIdentity) ?? null
		}))
	};
}

function shouldReadPage(page: KnownArchiveEvidencePageRequest): boolean {
	return page.limit > 0 && page.snapshotTotal !== 0;
}
