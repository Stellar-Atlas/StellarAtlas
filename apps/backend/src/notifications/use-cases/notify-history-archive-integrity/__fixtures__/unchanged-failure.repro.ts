import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { Logger } from 'winston';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import Node from '@network-scan/domain/node/Node.js';
import NodePublicKey from '@network-scan/domain/node/PublicKey.js';
import NodeDetails from '@network-scan/domain/node/NodeDetails.js';
import { EventSourceIdFactory } from '../../../domain/event/EventSourceIdFactory.js';
import { EventSource } from '../../../domain/event/EventSource.js';
import type { EventSourceService } from '../../../domain/event/EventSourceService.js';
import { Notifier } from '../../../domain/notifier/Notifier.js';
import { EJSMessageCreator } from '../../../infrastructure/services/EJSMessageCreator.js';
import { HistoryArchiveIntegrityNotificationRunLock } from '../../../infrastructure/database/HistoryArchiveIntegrityNotificationRunLock.js';
import { Subscribe } from '../../subscribe/Subscribe.js';
import { ConfirmSubscription } from '../../confirm-subscription/ConfirmSubscription.js';
import { Unsubscribe } from '../../unsubscribe/Unsubscribe.js';
import { NotifyHistoryArchiveIntegrityFailures } from '../NotifyHistoryArchiveIntegrityFailures.js';
import {
	CapturingMailTransport,
	CurrentNotificationStore,
	fixtureEmail,
	fixtureNode,
	fixtureUser
} from './CurrentNotificationStore.js';

const root = 'https://history.fixture.invalid';
const firstTime = new Date('2026-11-02T00:00:00.000Z');
const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		if (
			path.dirname(directory) !== os.tmpdir() ||
			!path.basename(directory).startsWith('email001-repro-')
		)
			throw new Error('Unsafe cleanup path');
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

// Explicitly selected reproduction, not a normal CI promise to preserve the bug.
it('reproduces duplicate actual mail for the same failure with a newer timestamp after state reload', async () => {
	const f = fixture();
	await f.activate();
	await f.run([failure(firstTime)]);
	expect(f.transport.alerts).toHaveLength(1);
	expect(f.store().readStoredStates()).toEqual([
		{
			latestSendTime: firstTime.toISOString(),
			eventType: 'HistoryArchiveErrorDetected',
			ignoreCoolOffPeriod: false
		}
	]);
	await f.run([failure(new Date(firstTime.getTime() + 1))]);
	expect(f.transport.alerts).toHaveLength(2);
	for (const mail of f.transport.alerts) {
		expect(mail.body).toContain('Archive verification details');
		expect(mail.body).toContain('bucket_hash_mismatch');
		expect(mail.body).not.toContain('RAW_DIAGNOSTIC_PRIVATE_MARKER');
	}
});

it('retains the existing suppression when the observation timestamp is exactly identical', async () => {
	const f = fixture();
	await f.activate();
	await f.run([failure(firstTime)]);
	await f.run([failure(firstTime)]);
	expect(f.transport.alerts).toHaveLength(1);
});

it('shows why a time-only fix would lose a genuine changed-error alert', async () => {
	const f = fixture();
	await f.activate();
	await f.run([failure(firstTime)]);
	await f.run([
		failure(new Date(firstTime.getTime() + 1), 'invalid_checkpoint_state')
	]);
	expect(f.transport.alerts).toHaveLength(2);
	expect(f.transport.alerts[1]?.body).toContain('invalid_checkpoint_state');
});

it('retains opt-in confirmation and fresh-run unsubscribe exclusion through actual use cases', async () => {
	const f = fixture();
	await f.subscribe();
	await f.run([failure(firstTime)]);
	expect(f.transport.alerts).toHaveLength(0);
	expect(f.objects.findActionableByArchiveUrl).not.toHaveBeenCalled();
	await f.confirm();
	await f.run([failure(firstTime)]);
	expect(f.transport.alerts).toHaveLength(1);
	const subscriber = await f.store().findOneByUserId(fixtureUser);
	if (subscriber === null) throw new Error('Missing active fixture subscriber');
	const result = await new Unsubscribe(
		f.store(),
		f.transport,
		mock<ExceptionLogger>()
	).execute({ subscriberReference: subscriber.subscriberReference.value });
	expect(result.isOk()).toBe(true);
	await f.run([failure(new Date(firstTime.getTime() + 1))]);
	expect(f.transport.alerts).toHaveLength(1);
	expect(await f.store().find()).toEqual([]);
});

it('does not acknowledge a failed fake-transport send and permits a fresh retry', async () => {
	const f = fixture();
	await f.activate();
	f.transport.failNext = true;
	const failed = await f.run([failure(firstTime)]);
	expect(failed.isOk() && failed.value.failedNotifications).toBe(1);
	expect(f.store().readStoredStates()).toEqual([]);
	await f.run([failure(firstTime)]);
	expect(f.transport.alerts).toHaveLength(1);
});

it('shows that silent removal/reappearance has no persisted recovery identity', async () => {
	const f = fixture();
	await f.activate();
	await f.run([failure(firstTime)]);
	await f.run([]);
	expect(f.transport.alerts).toHaveLength(1);
	await f.run([failure(new Date(firstTime.getTime() + 2))]);
	expect(f.transport.alerts).toHaveLength(2);
});

it('proves distinct failures produce identical existing persisted notification columns', async () => {
	const left = fixture(),
		right = fixture();
	await left.activate();
	await right.activate();
	await left.run([failure(firstTime, 'bucket_hash_mismatch', 'bucket-a')]);
	await right.run([failure(firstTime, 'invalid_checkpoint_state', 'bucket-b')]);
	expect(left.store().readStoredStates()).toEqual(
		right.store().readStoredStates()
	);
	expect(left.transport.alerts[0]?.body).toContain('bucket-a');
	expect(right.transport.alerts[0]?.body).toContain('bucket-b');
});

it('exposes the existing per-type collision for different objects at the same timestamp', async () => {
	const f = fixture();
	await f.activate();
	await f.run([
		failure(firstTime, 'bucket_hash_mismatch', 'bucket-a'),
		failure(firstTime, 'bucket_hash_mismatch', 'bucket-b')
	]);
	expect(f.transport.alerts).toHaveLength(1);
	expect(f.transport.alerts[0]?.body).toContain('Object: bucket-a');
	expect(f.transport.alerts[0]?.body).not.toContain('Object: bucket-b');
});

function fixture() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'email001-repro-'));
	directories.push(directory);
	const store = () => new CurrentNotificationStore(directory);
	const transport = new CapturingMailTransport();
	const sources = mock<EventSourceService>();
	sources.isEventSourceIdKnown.mockResolvedValue(ok(true));
	sources.findEventSource.mockImplementation(async (id) =>
		ok(new EventSource(id, 'Fixture archive node'))
	);
	const creator = new EJSMessageCreator(
		'https://frontend.fixture.invalid',
		sources
	);
	const objects = mock<HistoryArchiveObjectRepository>();
	const nodes = mock<NodeRepository>();
	const nodeKey = NodePublicKey.create(fixtureNode.value);
	if (nodeKey.isErr()) throw nodeKey.error;
	const node = Node.create(firstTime, nodeKey.value, {
		ip: '192.0.2.1',
		port: 11625
	});
	node.updateDetails(
		NodeDetails.create({
			host: null,
			name: 'Fixture node',
			historyUrl: root,
			alias: null
		}),
		firstTime
	);
	nodes.findAllKnown.mockResolvedValue([node]);
	const lock = mock<HistoryArchiveIntegrityNotificationRunLock>();
	lock.tryRun.mockImplementation(async (work) => ({
		acquired: true,
		value: await work()
	}));
	const subscribe = async () => {
		const result = await new Subscribe(
			creator,
			new EventSourceIdFactory(sources),
			store(),
			transport
		).execute({
			time: firstTime,
			emailAddress: fixtureEmail,
			eventSourceIds: [{ type: 'node', id: fixtureNode.value }]
		});
		if (result.isErr()) throw result.error;
	};
	const confirm = async () => {
		const subscriber = await store().findOneByUserId(fixtureUser);
		if (!subscriber?.pendingSubscription)
			throw new Error('Missing fixture confirmation');
		const result = await new ConfirmSubscription(store()).execute({
			pendingSubscriptionId:
				subscriber.pendingSubscription.pendingSubscriptionId.value
		});
		if (result.isErr()) throw result.error;
	};
	const run = async (findings: HistoryArchiveObject[]) => {
		objects.findActionableByArchiveUrl.mockResolvedValue(findings);
		return new NotifyHistoryArchiveIntegrityFailures(
			objects,
			nodes,
			store(),
			new Notifier(transport, creator),
			lock,
			mock<Logger>(),
			mock<ExceptionLogger>()
		).execute();
	};
	return {
		store,
		transport,
		objects,
		subscribe,
		confirm,
		activate: async () => {
			await subscribe();
			await confirm();
		},
		run
	};
}

function failure(
	observedAt: Date,
	code = 'bucket_hash_mismatch',
	key = 'bucket-a'
): HistoryArchiveObject {
	const object = new HistoryArchiveObject({
		archiveUrl: root,
		archiveUrlIdentity: root,
		bucketHash: 'a'.repeat(64),
		checkpointLedger: 63,
		objectKey: key,
		objectOrder: 63,
		objectType: 'bucket',
		objectUrl: `${root}/bucket/a`,
		remoteId: `fixture-${key}`
	});
	object.status = 'failed';
	object.errorType = code;
	object.errorMessage = 'RAW_DIAGNOSTIC_PRIVATE_MARKER';
	object.httpStatus = null;
	Object.defineProperty(object, 'updatedAt', { value: observedAt });
	return object;
}
