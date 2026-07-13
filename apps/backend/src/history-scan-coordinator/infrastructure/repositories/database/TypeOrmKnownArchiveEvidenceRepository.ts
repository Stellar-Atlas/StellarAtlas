import { injectable } from 'inversify';
import { DataSource, In } from 'typeorm';
import { HistoryArchiveStateSnapshot } from '../../../domain/history-archive-state/HistoryArchiveStateSnapshot.js';
import type {
	KnownArchiveEvidenceQuery,
	KnownArchiveEvidenceReadModel,
	KnownArchiveEvidenceRepository
} from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';
import { findKnownArchiveEvidenceRoots } from './KnownArchiveEvidenceRootQuery.js';
import { findKnownArchiveFailurePage } from './KnownArchiveFailurePageQuery.js';
import { findKnownArchiveCopyCoverage } from './KnownArchiveCopyCoverageQuery.js';
import { findKnownArchiveObjectPage } from './KnownArchiveObjectPageQuery.js';
import { findKnownArchiveObjectEventPage } from './KnownArchiveObjectEventPageQuery.js';
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

		const archiveUrlIdentities = query.roots.map(
			(root) => root.archiveUrlIdentity
		);
		const manager = this.dataSource.manager;
		const [rootRows, states] = await Promise.all([
			findKnownArchiveEvidenceRoots(manager, query.roots, query.snapshotAt),
			manager.getRepository(HistoryArchiveStateSnapshot).findBy({
				archiveUrlIdentity: In(archiveUrlIdentities)
			})
		]);
		const remoteFailurePage = applyKnownArchiveFailureAggregateTotal(
			query.remoteFailures,
			rootRows,
			'remote'
		);
		const workerIssuePage = applyKnownArchiveFailureAggregateTotal(
			query.workerIssues,
			rootRows,
			'infrastructure'
		);
		const objectPageRequest = applyKnownArchiveObjectAggregateTotal(
			query.objectPage,
			rootRows
		);
		const [remoteFailures, workerIssues, objectPage, eventPage] =
			await Promise.all([
				findKnownArchiveFailurePage(
					manager,
					archiveUrlIdentities,
					remoteFailurePage,
					'remote'
				),
				findKnownArchiveFailurePage(
					manager,
					archiveUrlIdentities,
					workerIssuePage,
					'infrastructure'
				),
				findKnownArchiveObjectPage(
					manager,
					archiveUrlIdentities,
					objectPageRequest
				),
				findKnownArchiveObjectEventPage(
					manager,
					archiveUrlIdentities,
					query.eventPage
				)
			]);
		const pageRemoteFailures = remoteFailures.failures.slice(
			0,
			query.remoteFailures.limit
		);
		const copyCoverage = await findKnownArchiveCopyCoverage(
			manager,
			pageRemoteFailures.map((failure) => failure.object),
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
			roots: rootRows.map((root) => ({
				...root,
				scannerOwnedState: statesByIdentity.get(root.archiveUrlIdentity) ?? null
			})),
			workerIssues
		};
	}
}
