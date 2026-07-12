import { mock } from 'jest-mock-extended';
import type { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import {
	findKnownArchiveObjectPage,
	knownArchiveObjectCountSql,
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
		manager.query.mockResolvedValue(
			roots.map((requestedRoot) => ({
				...emptyCounts,
				...requestedRoot,
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
		expect(manager.query).toHaveBeenCalledWith(knownArchiveEvidenceRootSql, [
			roots.map((item) => item.archiveUrl),
			roots.map((item) => item.archiveUrlIdentity),
			snapshotAt
		]);
		expect(knownArchiveEvidenceRootSql).toContain('from requested_roots root');
		expect(knownArchiveEvidenceRootSql).toContain(
			'left join history_archive_evidence_root_summary summary'
		);
		expect(knownArchiveEvidenceRootSql).toContain(
			'archive_object."createdAt" > $3::timestamptz'
		);
		expect(knownArchiveEvidenceRootSql).toContain(
			'summary_progress."complete" is not true'
		);
	});

	it('rejects root counts that exceed the safe JavaScript integer range', async () => {
		const manager = mock<EntityManager>();
		manager.query.mockResolvedValue([
			{
				archiveUrl: root,
				archiveUrlIdentity: root,
				totalObjects: '9007199254740992'
			}
		]);

		await expect(
			findKnownArchiveEvidenceRoots(
				manager,
				[{ archiveUrl: root, archiveUrlIdentity: root }],
				snapshotAt
			)
		).rejects.toThrow('totalObjects');
	});

	it('uses an exact filtered count and a limit-plus-one object page', async () => {
		const manager = mock<EntityManager>();
		manager.query
			.mockResolvedValueOnce([{ objectCount: '42' }])
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
				26,
				1,
				24,
				2
			]
		);
		expect(knownArchiveObjectPageSql).toContain('end as "delayReasonCode"');
		expect(knownArchiveObjectPageSql).toContain('end as "delayReasonUntil"');
		expect(knownArchiveObjectPageSql).toContain('page_keys as materialized');
		expect(knownArchiveObjectPageSql).toContain(
			'join history_archive_object_queue archive_object'
		);
		expect(knownArchiveObjectPageSql).toContain("then 'host-backoff'");
		expect(knownArchiveObjectPageSql).toContain("then 'missing-dependency'");
	});

	it('counts and pages remote failures separately from infrastructure failures', async () => {
		const manager = mock<EntityManager>();
		manager.query
			.mockResolvedValueOnce([{ failureCount: '7' }])
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
