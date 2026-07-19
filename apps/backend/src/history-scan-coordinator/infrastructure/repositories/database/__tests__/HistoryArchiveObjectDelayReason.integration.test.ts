import { DataSource } from 'typeorm';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { TypeOrmHistoryArchiveObjectRepository } from '../TypeOrmHistoryArchiveObjectRepository.js';
import { findKnownArchiveObjectPage } from '../KnownArchiveObjectPageQuery.js';
import {
	createObjectRepositoryDataSource,
	insertHistoryArchiveHostThrottle,
	resetHistoryArchiveObjectQueue,
	rootObject,
	saveHistoryArchiveObjects
} from './HistoryArchiveObjectRepositoryFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('history archive object delay reasons in disposable PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveObjectRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createObjectRepositoryDataSource(
			postgres.url
		));
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await resetHistoryArchiveObjectQueue(dataSource);
	});

	it('publishes retry windows for failed work in both object projections', async () => {
		const target = rootObject('https://retry-window.example/archive', 'failed');
		target.nextAttemptAt = new Date(Date.now() + 60_000);
		await saveHistoryArchiveObjects(dataSource, target);

		await expectReasonInBoth(target, 'retry-window', target.nextAttemptAt);
	});

	it('publishes host backoff ahead of an object retry window', async () => {
		const target = rootObject('https://host-backoff.example/archive', 'failed');
		target.nextAttemptAt = new Date(Date.now() + 60_000);
		const blockedUntil = new Date(Date.now() + 120_000);
		await saveHistoryArchiveObjects(dataSource, target);
		await insertHistoryArchiveHostThrottle(
			dataSource,
			target.hostIdentity,
			blockedUntil
		);

		await expectReasonInBoth(target, 'host-backoff', blockedUntil);
	});

	it('publishes host, archive, and global active caps', async () => {
		const hostTarget = rootObject('https://caps.example/archive-c');
		await saveHistoryArchiveObjects(
			dataSource,
			rootObject('https://caps.example/archive-a', 'scanning'),
			rootObject('https://caps.example/archive-b', 'scanning'),
			hostTarget
		);
		await expectReasonInBoth(hostTarget, 'host-active-cap', null);

		await resetHistoryArchiveObjectQueue(dataSource);
		const archiveUrl = 'https://archive-cap.example/archive';
		const archiveTarget = categoryObject(archiveUrl, 'transactions', 'pending');
		await saveHistoryArchiveObjects(
			dataSource,
			rootObject(archiveUrl, 'verified'),
			categoryObject(archiveUrl, 'ledger', 'scanning'),
			archiveTarget
		);
		await expectReasonInBoth(archiveTarget, 'archive-active-cap', null);

		await resetHistoryArchiveObjectQueue(dataSource);
		const globalTarget = rootObject('https://global-target.example/archive');
		await saveHistoryArchiveObjects(
			dataSource,
			...Array.from({ length: 24 }, (_, index) =>
				rootObject(`https://active-${index}.example/archive`, 'scanning')
			),
			globalTarget
		);
		await expectReasonInBoth(globalTarget, 'global-active-cap', null);
	});

	it('publishes dependency and active-object blockers', async () => {
		const dependency = categoryObject(
			'https://dependency.example/archive',
			'ledger',
			'pending'
		);
		dependency.dependencyReady = false;
		await saveHistoryArchiveObjects(dataSource, dependency);
		await expectReasonInBoth(dependency, 'missing-dependency', null);

		await resetHistoryArchiveObjectQueue(dataSource);
		const active = rootObject('https://active.example/archive', 'scanning');
		await saveHistoryArchiveObjects(dataSource, active);
		await expectReasonInBoth(active, 'object-already-active', null);
	});

	it('does not replace failed-object evidence with a dependency delay', async () => {
		const failed = categoryObject(
			'https://failed-dependency.example/archive',
			'ledger',
			'failed'
		);
		failed.dependencyReady = false;
		await saveHistoryArchiveObjects(dataSource, failed);

		const queue = await repository.findByArchiveUrl(failed.archiveUrl, 10);
		const page = await findKnownArchiveObjectPage(
			dataSource.manager,
			[failed.archiveUrlIdentity],
			{
				before: null,
				filters: {
					archiveUrlIdentity: failed.archiveUrlIdentity,
					objectType: failed.objectType,
					status: failed.status
				},
				limit: 10,
				snapshotAt: new Date(Date.now() + 1_000),
				snapshotTotal: 1
			}
		);

		expect(queue.objects[0]?.delayReason).toBeNull();
		expect(page.objects[0]?.delayReason).toBeNull();
	});

	async function expectReasonInBoth(
		target: HistoryArchiveObject,
		code: NonNullable<HistoryArchiveObject['delayReason']>['code'],
		until: Date | null
	): Promise<void> {
		const queue = await repository.findByArchiveUrl(target.archiveUrl, 10);
		const page = await findKnownArchiveObjectPage(
			dataSource.manager,
			[target.archiveUrlIdentity],
			{
				before: null,
				filters: {
					archiveUrlIdentity: target.archiveUrlIdentity,
					objectType: target.objectType,
					status: target.status
				},
				limit: 10,
				snapshotAt: new Date(Date.now() + 1_000),
				snapshotTotal: 1
			}
		);
		const expected = { code, until: until?.toISOString() ?? null };

		expect(
			queue.objects.find((object) => object.remoteId === target.remoteId)
				?.delayReason
		).toEqual(expected);
		expect(
			page.objects.find((object) => object.remoteId === target.remoteId)
				?.delayReason
		).toEqual(expected);
	}
});

function categoryObject(
	archiveUrl: string,
	objectType: 'ledger' | 'transactions',
	status: HistoryArchiveObject['status']
): HistoryArchiveObject {
	return new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		checkpointLedger: 127,
		objectKey: `${objectType}:0000007f`,
		objectOrder: objectType === 'ledger' ? 20 : 30,
		objectType,
		objectUrl: `${archiveUrl}/${objectType}/0000007f.xdr.gz`,
		status
	});
}
