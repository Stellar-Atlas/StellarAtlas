import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type Node from '@network-scan/domain/node/Node.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { Logger } from 'winston';
import { HistoryArchiveIntegrityFailureDetectedEvent } from '../../../domain/event/Event.js';
import { Notifier } from '../../../domain/notifier/Notifier.js';
import type { Subscriber } from '../../../domain/subscription/Subscriber.js';
import type { SubscriberRepository } from '../../../domain/subscription/SubscriberRepository.js';
import { HistoryArchiveIntegrityNotificationRunLock } from '../../../infrastructure/database/HistoryArchiveIntegrityNotificationRunLock.js';
import { NotifyHistoryArchiveIntegrityFailures } from '../NotifyHistoryArchiveIntegrityFailures.js';

const archiveUrl = 'https://history.example.org';
const publicKey = 'GCGB2S2KGYARPVIA37HYZXVRM2YZUEXA6S33ZU5BUDC6THSB62LZSTYH';

describe('NotifyHistoryArchiveIntegrityFailures', () => {
	it('does not read nodes or archive evidence when there are no subscribers', async () => {
		const fixture = createFixture([failedObject('bucket_hash_mismatch')]);
		fixture.subscriberRepository.find.mockResolvedValue([]);
		const result = await fixture.useCase.execute();

		expect(result.isOk()).toBe(true);
		if (result.isOk())
			expect(result.value).toMatchObject({
				candidateEvents: 0,
				inspectedArchiveRoots: 0,
				sentNotifications: 0,
				skippedDueToConcurrentRun: false
			});
		expect(fixture.nodeRepository.findAllKnown).not.toHaveBeenCalled();
		expect(
			fixture.objectRepository.findActionableByArchiveUrl
		).not.toHaveBeenCalled();
		expect(fixture.subscriberRepository.save).not.toHaveBeenCalled();
	});

	it('does not read archive evidence for an unsubscribed owning node', async () => {
		const fixture = createFixture([failedObject('bucket_hash_mismatch')]);
		fixture.subscriber.isSubscribedTo.mockReturnValue(false);
		const result = await fixture.useCase.execute();

		expect(result.isOk()).toBe(true);
		expect(
			fixture.objectRepository.findActionableByArchiveUrl
		).not.toHaveBeenCalled();
		expect(fixture.events).toEqual([]);
		expect(fixture.subscriberRepository.save).not.toHaveBeenCalled();
	});

	it('checks only a root with a subscribed owner and retains its evidence limit', async () => {
		const fixture = createFixture([failedObject('bucket_hash_mismatch')]);
		const otherKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
		fixture.nodeRepository.findAllKnown.mockResolvedValue([
			{ details: { historyUrl: archiveUrl }, publicKey: { value: publicKey } },
			{
				details: { historyUrl: 'https://unsubscribed.example.org' },
				publicKey: { value: otherKey }
			}
		] as unknown as Node[]);
		fixture.subscriber.isSubscribedTo.mockImplementation(
			(source) => source.value === publicKey
		);
		const result = await fixture.useCase.execute({ objectsPerArchiveRoot: 23 });

		expect(result.isOk()).toBe(true);
		expect(
			fixture.objectRepository.findActionableByArchiveUrl
		).toHaveBeenCalledTimes(1);
		expect(
			fixture.objectRepository.findActionableByArchiveUrl
		).toHaveBeenCalledWith(archiveUrl, 23);
		expect(fixture.events).toHaveLength(1);
	});

	it('preserves a shared root when any owner is subscribed', async () => {
		const fixture = createFixture([failedObject('bucket_hash_mismatch')]);
		const otherKey = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
		fixture.nodeRepository.findAllKnown.mockResolvedValue([
			{ details: { historyUrl: archiveUrl }, publicKey: { value: otherKey } },
			{ details: { historyUrl: archiveUrl }, publicKey: { value: publicKey } }
		] as unknown as Node[]);
		fixture.subscriber.isSubscribedTo.mockImplementation(
			(source) => source.value === publicKey
		);
		const result = await fixture.useCase.execute();

		expect(result.isOk()).toBe(true);
		expect(
			fixture.objectRepository.findActionableByArchiveUrl
		).toHaveBeenCalledTimes(1);
		expect(
			fixture.events.some((event) => event.sourceId.value === publicKey)
		).toBe(true);
	});

	it('does not publish or acknowledge findings after a candidate read failure', async () => {
		const fixture = createFixture([failedObject('bucket_hash_mismatch')]);
		fixture.objectRepository.findActionableByArchiveUrl.mockRejectedValue(
			new Error('read deferred')
		);
		const result = await fixture.useCase.execute();

		expect(result.isErr()).toBe(true);
		expect(fixture.subscriber.publishNotificationAbout).not.toHaveBeenCalled();
		expect(fixture.subscriberRepository.save).not.toHaveBeenCalled();
		expect(fixture.notifier.sendNotifications).not.toHaveBeenCalled();
	});

	it('maps a confirmed hash mismatch to the owning node without leaking error text', async () => {
		const fixture = createFixture([failedObject('bucket_hash_mismatch')]);
		const result = await fixture.useCase.execute();

		expect(result.isOk()).toBe(true);
		expect(fixture.events).toHaveLength(1);
		const [event] = fixture.events;
		expect(event).toBeInstanceOf(HistoryArchiveIntegrityFailureDetectedEvent);
		expect(event?.sourceId.value).toBe(publicKey);
		expect(event?.data).toMatchObject({
			actionId: 'replace-bucket-file:archive-object-id',
			evidenceId: 'archive-object-id',
			failureCode: 'bucket_hash_mismatch',
			repairPlanPath: `/v1/archive-scans/${encodeURIComponent(archiveUrl)}/repair-plan`
		});
		expect(event?.data).not.toHaveProperty('errorMessage');
		expect(fixture.notifier.sendNotifications).not.toHaveBeenCalled();
	});

	it.each([
		['http_404', 404],
		['http_403', 403],
		['rate_limit', 429],
		['timeout', null],
		['worker_error', null]
	])(
		'does not generate an archive-corruption notification for %s',
		async (errorType, httpStatus) => {
			const fixture = createFixture([failedObject(errorType, httpStatus)]);
			const result = await fixture.useCase.execute();

			expect(result.isOk()).toBe(true);
			expect(fixture.events).toEqual([]);
			expect(fixture.notifier.sendNotifications).not.toHaveBeenCalled();
		}
	);
});

function createFixture(objects: readonly HistoryArchiveObject[]) {
	const objectRepository = mock<HistoryArchiveObjectRepository>();
	objectRepository.findActionableByArchiveUrl.mockResolvedValue(objects);
	const nodeRepository = mock<NodeRepository>();
	nodeRepository.findAllKnown.mockResolvedValue([
		{
			details: { historyUrl: archiveUrl },
			publicKey: { value: publicKey }
		} as unknown as Node
	]);
	const events: HistoryArchiveIntegrityFailureDetectedEvent[] = [];
	const subscriber = mock<Subscriber>();
	subscriber.isSubscribedTo.mockReturnValue(true);
	subscriber.publishNotificationAbout.mockImplementation((candidateEvents) => {
		events.push(
			...candidateEvents.filter(
				(event): event is HistoryArchiveIntegrityFailureDetectedEvent =>
					event instanceof HistoryArchiveIntegrityFailureDetectedEvent
			)
		);
		return null;
	});
	const subscriberRepository = mock<SubscriberRepository>();
	subscriberRepository.find.mockResolvedValue([subscriber]);
	const notifier = mock<Notifier>();
	const runLock = mock<HistoryArchiveIntegrityNotificationRunLock>();
	runLock.tryRun.mockImplementation(async (work) => ({
		acquired: true,
		value: await work()
	}));
	const useCase = new NotifyHistoryArchiveIntegrityFailures(
		objectRepository,
		nodeRepository,
		subscriberRepository,
		notifier,
		runLock,
		mock<Logger>(),
		mock<ExceptionLogger>()
	);

	return {
		events,
		notifier,
		useCase,
		objectRepository,
		nodeRepository,
		subscriber,
		subscriberRepository
	};
}

function failedObject(
	errorType: string,
	httpStatus: number | null = null
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl,
		archiveUrlIdentity: archiveUrl,
		bucketHash: 'a'.repeat(64),
		checkpointLedger: 63,
		objectKey: 'bucket-a',
		objectOrder: 63,
		objectType: 'bucket',
		objectUrl: `${archiveUrl}/bucket/a`,
		remoteId: 'archive-object-id'
	});
	object.errorType = errorType;
	object.errorMessage = '/home/observe/private-path';
	object.httpStatus = httpStatus;
	object.status = 'failed';
	Object.defineProperty(object, 'updatedAt', {
		value: new Date('2026-08-05T00:00:00.000Z')
	});
	return object;
}
