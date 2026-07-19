import { mock, type MockProxy } from 'jest-mock-extended';
import type { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import {
	findKnownArchiveObjectPage,
	knownArchiveObjectActiveContextSql,
	knownArchiveObjectCountSql,
	knownArchiveObjectHostThrottleSql,
	knownArchiveObjectPageSql
} from '../KnownArchiveObjectPageQuery.js';
import {
	findKnownArchiveObjectEventPage,
	knownArchiveObjectEventPageKeysSql,
	knownArchiveObjectEventTotalSql
} from '../KnownArchiveObjectEventPageQuery.js';
import {
	findKnownArchiveFailurePage,
	knownArchiveFailureCountSql,
	knownArchiveFailurePageSql
} from '../KnownArchiveFailurePageQuery.js';
import {
	findKnownArchiveEvidenceRoots,
	knownArchiveEvidenceFutureCheckpointSql,
	knownArchiveEvidenceFutureObjectSql,
	knownArchiveEvidenceLatestObjectSql,
	knownArchiveEvidenceRootSql
} from '../KnownArchiveEvidenceRootQuery.js';

const root = 'https://history.example.com';
const cursor = {
	at: new Date('2026-07-10T00:00:00.000Z'),
	remoteId: '11111111-1111-4111-8111-111111111111'
};
const snapshotAt = new Date('2026-07-10T01:00:00.000Z');

describe('known archive page queries', () => {
	it('preserves every requested root even when a root has no scanner rows', async () => {
		const emptyCounts = {
			activeObjects: '0',
			bucketObjects: '0',
			mismatchedCheckpoints: '0',
			notEvaluableCheckpoints: '0',
			pendingCheckpoints: '0',
			pendingObjects: '0',
			remoteFailureObjects: '0',
			totalCheckpoints: '0',
			totalObjects: '0',
			verifiedBucketObjects: '0',
			verifiedCheckpoints: '0',
			verifiedObjects: '0',
			workerIssueObjects: '0'
		};
		const roots = [
			{ archiveUrl: root, archiveUrlIdentity: root },
			{
				archiveUrl: 'https://second.example.com',
				archiveUrlIdentity: 'https://second.example.com'
			}
		];
		const manager = mock<EntityManager>();
		useTransactionManager(manager);
		manager.query
			.mockResolvedValueOnce(
				roots.map((requestedRoot) => ({
					...emptyCounts,
					...requestedRoot,
					rollupComplete: true
				}))
			)
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(
				roots.map((requestedRoot) => ({
					archiveUrlIdentity: requestedRoot.archiveUrlIdentity,
					latestObjectAt: null
				}))
			);
		const result = await findKnownArchiveEvidenceRoots(
			manager,
			roots,
			snapshotAt
		);

		expect(result).toHaveLength(2);
		expect(result.map((item) => item.archiveUrlIdentity)).toEqual(
			roots.map((item) => item.archiveUrlIdentity)
		);
		expect(manager.query).toHaveBeenNthCalledWith(
			1,
			knownArchiveEvidenceRootSql,
			[
				roots.map((item) => item.archiveUrl),
				roots.map((item) => item.archiveUrlIdentity)
			]
		);
		expect(manager.query).toHaveBeenNthCalledWith(
			2,
			knownArchiveEvidenceFutureObjectSql,
			[roots.map((item) => item.archiveUrlIdentity), snapshotAt]
		);
		expect(manager.query).toHaveBeenNthCalledWith(
			3,
			knownArchiveEvidenceFutureCheckpointSql,
			[roots.map((item) => item.archiveUrlIdentity), snapshotAt]
		);
		expect(manager.query).toHaveBeenNthCalledWith(
			4,
			knownArchiveEvidenceLatestObjectSql,
			[roots.map((item) => item.archiveUrlIdentity), snapshotAt]
		);
		expect(knownArchiveEvidenceRootSql).toContain('from requested_roots root');
		expect(knownArchiveEvidenceRootSql).toContain(
			'left join history_archive_evidence_root_summary summary'
		);
		expect(knownArchiveEvidenceFutureObjectSql).toContain(
			'archive_object."createdAt" > $2::timestamptz'
		);
		expect(knownArchiveEvidenceRootSql).toContain(
			'history_archive_evidence_root_summary_progress'
		);
		expect(knownArchiveEvidenceRootSql).toContain(
			'history_archive_checkpoint_proof_rollup'
		);
		expect(knownArchiveEvidenceFutureCheckpointSql).toContain(
			'proof."createdAt" > $2::timestamptz'
		);
		expect(knownArchiveEvidenceLatestObjectSql).toContain(
			'archive_object."createdAt" <= $2::timestamptz'
		);
		expect(knownArchiveEvidenceRootSql).not.toContain('snapshot_objects');
	});

	it('fails closed while the root summary rollup is incomplete', async () => {
		const manager = mock<EntityManager>();
		useTransactionManager(manager);
		manager.query
			.mockResolvedValueOnce([
				{
					archiveUrl: root,
					archiveUrlIdentity: root,
					rollupComplete: false
				}
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([]);

		await expect(
			findKnownArchiveEvidenceRoots(
				manager,
				[{ archiveUrl: root, archiveUrlIdentity: root }],
				snapshotAt
			)
		).rejects.toThrow('Archive evidence root summary is not ready');
		expect(manager.query).toHaveBeenCalledTimes(1);
	});

	it('rejects root counts that exceed the safe JavaScript integer range', async () => {
		const manager = mock<EntityManager>();
		useTransactionManager(manager);
		manager.query
			.mockResolvedValueOnce([
				{
					archiveUrl: root,
					archiveUrlIdentity: root,
					rollupComplete: true,
					totalObjects: '9007199254740992'
				}
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ archiveUrlIdentity: root, latestObjectAt: null }
			]);

		await expect(
			findKnownArchiveEvidenceRoots(
				manager,
				[{ archiveUrl: root, archiveUrlIdentity: root }],
				snapshotAt
			)
		).rejects.toThrow('totalObjects');
	});

	it('uses rolled-up filtered totals and a limit-plus-one object page', async () => {
		const manager = mock<EntityManager>();
		manager.query
			.mockResolvedValueOnce([{ objectCount: '42', rollupComplete: true }])
			.mockResolvedValueOnce([]);

		const result = await findKnownArchiveObjectPage(manager, [root], {
			before: cursor,
			filters: {
				archiveUrlIdentity: root,
				objectType: 'bucket',
				status: 'failed'
			},
			limit: 25,
			snapshotAt,
			snapshotTotal: null
		});

		expect(result).toEqual({ objects: [], total: 42 });
		expect(manager.query).toHaveBeenNthCalledWith(
			1,
			knownArchiveObjectCountSql,
			[[root], root, 'bucket', 'failed', snapshotAt]
		);
		expect(manager.query).toHaveBeenNthCalledWith(
			2,
			knownArchiveObjectPageSql,
			[
				[root],
				root,
				'bucket',
				'failed',
				snapshotAt,
				cursor.at,
				cursor.remoteId,
				26
			]
		);
		expect(knownArchiveObjectPageSql).toContain('select candidate.*');
		expect(knownArchiveObjectPageSql).toContain(
			'from history_archive_object_queue archive_object'
		);
		expect(knownArchiveObjectActiveContextSql).toContain(
			"where status = 'scanning'"
		);
		expect(knownArchiveObjectHostThrottleSql).toContain(
			'"hostIdentity" = any($1::text[])'
		);
		expect(knownArchiveObjectCountSql).toContain(
			'history_archive_object_type_summary'
		);
		expect(knownArchiveObjectCountSql).toContain(
			'archive_object."createdAt" > $5::timestamptz'
		);
		expect(knownArchiveObjectCountSql).not.toContain(
			'archive_object."createdAt" <= $5::timestamptz'
		);
	});

	it('fails closed when filtered object rollups are incomplete', async () => {
		const manager = mock<EntityManager>();
		manager.query.mockResolvedValueOnce([
			{ objectCount: '42', rollupComplete: false }
		]);

		await expect(
			findKnownArchiveObjectPage(manager, [root], {
				before: null,
				filters: {
					archiveUrlIdentity: root,
					objectType: 'bucket',
					status: 'failed'
				},
				limit: 25,
				snapshotAt,
				snapshotTotal: null
			})
		).rejects.toThrow('Archive object evidence rollup is not ready');
	});

	it('counts and pages remote failures separately from infrastructure failures', async () => {
		const manager = mock<EntityManager>();
		manager.query
			.mockResolvedValueOnce([{ failureCount: '7', rollupComplete: true }])
			.mockResolvedValueOnce([]);
		const page = {
			before: cursor,
			filters: { archiveUrlIdentity: root, objectType: 'ledger' as const },
			limit: 10,
			snapshotAt,
			snapshotTotal: null
		};

		const result = await findKnownArchiveFailurePage(
			manager,
			[root],
			page,
			'remote'
		);

		expect(result).toEqual({ failures: [], total: 7 });
		expect(manager.query).toHaveBeenNthCalledWith(
			1,
			knownArchiveFailureCountSql('remote'),
			[[root], root, 'ledger', snapshotAt]
		);
		expect(manager.query).toHaveBeenNthCalledWith(
			2,
			knownArchiveFailurePageSql('remote'),
			[[root], root, 'ledger', snapshotAt, cursor.at, cursor.remoteId, 11]
		);
		expect(knownArchiveFailureCountSql('remote')).toContain(
			'"failureChannel" = \'archive_evidence\''
		);
		expect(knownArchiveFailureCountSql('infrastructure')).toContain(
			'"failureChannel" = \'scanner_issue\''
		);
		expect(knownArchiveFailurePageSql('remote')).toContain(
			'page_keys as materialized'
		);
		expect(knownArchiveFailurePageSql('remote')).toContain(
			'cross join lateral'
		);
		expect(knownArchiveFailureCountSql('remote')).toContain(
			'history_archive_object_type_summary'
		);
		expect(knownArchiveFailureCountSql('remote')).toContain(
			'archive_object."createdAt" > $4::timestamptz'
		);
		expect(knownArchiveFailureCountSql('remote')).not.toContain(
			'archive_object."createdAt" <= $4::timestamptz'
		);
		expect(knownArchiveFailureCountSql('infrastructure')).toContain(
			'root_summary."workerIssueObjects"'
		);
		expect(knownArchiveFailureCountSql('infrastructure')).toContain(
			'type_summary."scannerIssueObjects"'
		);
	});

	it('fails closed when filtered failure rollups are incomplete', async () => {
		const manager = mock<EntityManager>();
		manager.query.mockResolvedValueOnce([
			{ failureCount: '7', rollupComplete: false }
		]);

		await expect(
			findKnownArchiveFailurePage(
				manager,
				[root],
				{
					before: null,
					filters: { archiveUrlIdentity: root, objectType: 'ledger' },
					limit: 10,
					snapshotAt,
					snapshotTotal: null
				},
				'remote'
			)
		).rejects.toThrow('Archive failure evidence rollup is not ready');
	});

	it('does not query pages whose aggregate total is zero', async () => {
		const manager = mock<EntityManager>();
		const emptyObjectPage = await findKnownArchiveObjectPage(manager, [root], {
			before: null,
			filters: {
				archiveUrlIdentity: null,
				objectType: null,
				status: null
			},
			limit: 25,
			snapshotAt,
			snapshotTotal: 0
		});
		const emptyFailurePage = await findKnownArchiveFailurePage(
			manager,
			[root],
			{
				before: null,
				filters: { archiveUrlIdentity: null, objectType: null },
				limit: 25,
				snapshotAt,
				snapshotTotal: 0
			},
			'remote'
		);
		const emptyEventPage = await findKnownArchiveObjectEventPage(
			manager,
			[root],
			{
				before: null,
				filters: {
					archiveUrlIdentity: null,
					evidenceClass: null,
					eventType: null,
					objectType: null
				},
				limit: 25,
				snapshotAt,
				snapshotTotal: 0
			}
		);

		expect(emptyObjectPage).toEqual({ objects: [], total: 0 });
		expect(emptyFailurePage).toEqual({ failures: [], total: 0 });
		expect(emptyEventPage).toEqual({ events: [], total: 0 });
		expect(manager.query).not.toHaveBeenCalled();
		expect(manager.getRepository).not.toHaveBeenCalled();
	});

	it('applies event filters before exact counts and keyset pagination', async () => {
		const manager = mock<EntityManager>();
		const repository = mock<Repository<HistoryArchiveObjectEvent>>();
		const event = new HistoryArchiveObjectEvent({
			archiveUrl: root,
			archiveUrlIdentity: root,
			eventType: 'failed',
			evidenceClass: 'worker-infrastructure',
			objectKey: 'ledger:0000003f',
			objectRemoteId: '22222222-2222-4222-8222-222222222222',
			objectType: 'ledger',
			objectUrl: `${root}/ledger/object.xdr.gz`
		});
		manager.getRepository.mockReturnValue(repository);
		manager.query
			.mockResolvedValueOnce([{ total: '12' }])
			.mockResolvedValueOnce([{ remoteId: event.remoteId }]);
		repository.findBy.mockResolvedValue([event]);

		const result = await findKnownArchiveObjectEventPage(manager, [root], {
			before: cursor,
			filters: {
				archiveUrlIdentity: root,
				evidenceClass: 'worker-infrastructure',
				eventType: 'failed',
				objectType: 'ledger'
			},
			limit: 5,
			snapshotAt,
			snapshotTotal: null
		});

		expect(result).toEqual({ events: [event], total: 12 });
		expect(manager.query).toHaveBeenCalledWith(
			knownArchiveObjectEventTotalSql,
			[[root], root, 'worker-infrastructure', 'failed', 'ledger', snapshotAt]
		);
		expect(manager.query).toHaveBeenCalledWith(
			knownArchiveObjectEventPageKeysSql,
			[
				[root],
				root,
				'worker-infrastructure',
				'failed',
				'ledger',
				snapshotAt,
				cursor.at,
				cursor.remoteId,
				6
			]
		);
		expect(knownArchiveObjectEventPageKeysSql).toContain('cross join lateral');
		expect(repository.findBy).toHaveBeenCalledTimes(1);
	});
});

function useTransactionManager(manager: MockProxy<EntityManager>): void {
	manager.transaction.mockImplementation(async (_isolation, run) =>
		run(manager)
	);
}
