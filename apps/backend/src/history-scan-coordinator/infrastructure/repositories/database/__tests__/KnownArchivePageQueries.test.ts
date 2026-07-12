import { mock } from 'jest-mock-extended';
import type { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveObjectEvent } from '../../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import {
	findKnownArchiveObjectPage,
	knownArchiveObjectCountSql,
	knownArchiveObjectPageSql
} from '../KnownArchiveObjectPageQuery.js';
import { findKnownArchiveObjectEventPage } from '../KnownArchiveObjectEventPageQuery.js';
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
		const query = jest.fn().mockResolvedValue(
			roots.map((requestedRoot) => ({
				...emptyCounts,
				...requestedRoot,
				latestObjectAt: null
			}))
		);
		const manager = { query } as unknown as EntityManager;

		const result = await findKnownArchiveEvidenceRoots(
			manager,
			roots,
			snapshotAt
		);

		expect(result).toHaveLength(2);
		expect(result.map((item) => item.archiveUrlIdentity)).toEqual(
			roots.map((item) => item.archiveUrlIdentity)
		);
		expect(query).toHaveBeenCalledWith(knownArchiveEvidenceRootSql, [
			roots.map((item) => item.archiveUrl),
			roots.map((item) => item.archiveUrlIdentity),
			snapshotAt
		]);
		expect(knownArchiveEvidenceRootSql).toContain('from requested_roots root');
		expect(knownArchiveEvidenceRootSql).toContain('left join object_counts');
	});

	it('uses an exact filtered count and a limit-plus-one object page', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ objectCount: '42' }])
			.mockResolvedValueOnce([]);
		const manager = { query } as unknown as EntityManager;

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
		expect(query).toHaveBeenNthCalledWith(1, knownArchiveObjectCountSql, [
			[root],
			root,
			'bucket',
			'failed',
			snapshotAt
		]);
		expect(query).toHaveBeenNthCalledWith(2, knownArchiveObjectPageSql, [
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
		]);
		expect(knownArchiveObjectPageSql).toContain('end as "delayReasonCode"');
		expect(knownArchiveObjectPageSql).toContain('end as "delayReasonUntil"');
		expect(knownArchiveObjectPageSql).toContain(
			'page_keys as materialized'
		);
		expect(knownArchiveObjectPageSql).toContain(
			'join history_archive_object_queue archive_object'
		);
		expect(knownArchiveObjectPageSql).toContain("then 'host-backoff'");
		expect(knownArchiveObjectPageSql).toContain("then 'missing-dependency'");
	});

	it('counts and pages remote failures separately from infrastructure failures', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([{ failureCount: '7' }])
			.mockResolvedValueOnce([]);
		const manager = { query } as unknown as EntityManager;
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
		expect(query).toHaveBeenNthCalledWith(
			1,
			knownArchiveFailureCountSql('remote'),
			[[root], root, 'ledger', snapshotAt]
		);
		expect(query).toHaveBeenNthCalledWith(
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
	});

	it('applies event filters before exact counts and keyset pagination', async () => {
		const repository = mock<Repository<HistoryArchiveObjectEvent>>();
		const base = mock<SelectQueryBuilder<HistoryArchiveObjectEvent>>();
		const pageQuery = mock<SelectQueryBuilder<HistoryArchiveObjectEvent>>();
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
		repository.createQueryBuilder.mockReturnValue(base);
		base.where.mockReturnValue(base);
		base.andWhere.mockReturnValue(base);
		base.clone.mockReturnValue(pageQuery);
		base.getCount.mockResolvedValue(12);
		pageQuery.andWhere.mockReturnValue(pageQuery);
		pageQuery.orderBy.mockReturnValue(pageQuery);
		pageQuery.addOrderBy.mockReturnValue(pageQuery);
		pageQuery.take.mockReturnValue(pageQuery);
		pageQuery.getMany.mockResolvedValue([event]);

		const result = await findKnownArchiveObjectEventPage(repository, [root], {
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
		expect(base.andWhere).toHaveBeenCalledTimes(5);
		expect(pageQuery.andWhere).toHaveBeenCalledWith(
			expect.stringContaining('event.createdAt < :cursorAt'),
			{ cursorAt: cursor.at, cursorRemoteId: cursor.remoteId }
		);
		expect(pageQuery.take).toHaveBeenCalledWith(6);
	});
});
