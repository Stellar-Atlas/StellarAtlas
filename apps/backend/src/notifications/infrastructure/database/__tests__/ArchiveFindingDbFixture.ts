import { DataSource, type Logger as OrmLogger } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { Logger } from 'winston';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import Node from '@network-scan/domain/node/Node.js';
import NodeKey from '@network-scan/domain/node/PublicKey.js';
import NodeDetails from '@network-scan/domain/node/NodeDetails.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { Subscriber } from '../../../domain/subscription/Subscriber.js';
import { Subscription } from '../../../domain/subscription/Subscription.js';
import { PendingSubscription } from '../../../domain/subscription/PendingSubscription.js';
import { EventNotificationState } from '../../../domain/subscription/EventNotificationState.js';
import { HistoryArchiveIntegrityFailureDetectedEvent } from '../../../domain/event/Event.js';
import { EventSourceIdFactory } from '../../../domain/event/EventSourceIdFactory.js';
import { EventSource } from '../../../domain/event/EventSource.js';
import type { EventSourceService } from '../../../domain/event/EventSourceService.js';
import { Notifier } from '../../../domain/notifier/Notifier.js';
import { Subscribe } from '../../../use-cases/subscribe/Subscribe.js';
import { ConfirmSubscription } from '../../../use-cases/confirm-subscription/ConfirmSubscription.js';
import { Unsubscribe } from '../../../use-cases/unsubscribe/Unsubscribe.js';
import { UnmuteNotification } from '../../../use-cases/unmute-notification/UnmuteNotification.js';
import { EventType } from '../../../domain/event/Event.js';
import { NotifyHistoryArchiveIntegrityFailures } from '../../../use-cases/notify-history-archive-integrity/NotifyHistoryArchiveIntegrityFailures.js';
import {
	CapturingMailTransport,
	fixtureEmail,
	fixtureNode,
	fixtureUser
} from '../../../use-cases/notify-history-archive-integrity/__fixtures__/CurrentNotificationStore.js';
import { EJSMessageCreator } from '../../services/EJSMessageCreator.js';
import { TypeOrmSubscriberRepository } from '../repositories/TypeOrmSubscriberRepository.js';
import { HistoryArchiveIntegrityNotificationRunLock } from '../HistoryArchiveIntegrityNotificationRunLock.js';
import { PgArchiveFindingStateRepository } from '../PgArchiveFindingStateRepository.js';
import { ArchiveIntegrityNotificationState1793635200000 } from '@core/infrastructure/database/migrations/1793635200000-ArchiveIntegrityNotificationState.js';

export const initialTime = new Date('2026-11-02T00:00:00.000Z');
export const archiveRoot = 'https://history.fixture.invalid';
export const migration = new ArchiveIntegrityNotificationState1793635200000();
export const queryMetrics: { sql: string; arrayLengths: number[] }[] = [];
const quietLogger: OrmLogger = {
	logQuery: (sql, parameters) => {
		queryMetrics.push({
			sql,
			arrayLengths: (parameters ?? [])
				.filter(Array.isArray)
				.map((value) => value.length)
		});
	},
	logQueryError: () => undefined,
	logQuerySlow: () => undefined,
	logSchemaBuild: () => undefined,
	logMigration: () => undefined,
	log: () => undefined
};

export async function openDatabase(): Promise<DataSource> {
	if (process.env.EMAIL001_ISOLATED_PG !== '1')
		throw new Error('Explicit isolated database test opt-in required');
	// Deliberately fixed test-only destination. Never reads ACTIVE_DATABASE_URL/.env.
	const source = new DataSource({
		type: 'postgres',
		host: '127.0.0.1',
		port: 55439,
		database: 'email001_state4_fixture',
		username: 'email001_fixture',
		password: 'email001_local_fixture_only',
		entities: [
			Subscriber,
			Subscription,
			PendingSubscription,
			EventNotificationState
		],
		synchronize: false,
		logger: quietLogger,
		logging: ['query'],
		poolSize: 4
	});
	await source.initialize();
	return source;
}

export async function resetDatabase(source: DataSource): Promise<void> {
	await source.synchronize(true);
	const runner = source.createQueryRunner();
	await runner.connect();
	try {
		await migration.up(runner);
	} finally {
		await runner.release();
	}
	queryMetrics.length = 0;
}

export function event(
	time = initialTime,
	code = 'bucket_hash_mismatch',
	key = 'bucket-a'
): HistoryArchiveIntegrityFailureDetectedEvent {
	return new HistoryArchiveIntegrityFailureDetectedEvent(time, fixtureNode, {
		actionId: `replace-bucket-file:${key}`,
		archiveUrl: archiveRoot,
		bucketHash: 'a'.repeat(64),
		checkpointLedger: 63,
		evidenceId: `fixture-${key}`,
		evidenceObservedAt: time.toISOString(),
		failureCode: code,
		objectKey: key,
		objectType: 'bucket',
		repairPlanPath: '/v1/unused'
	});
}
export function object(
	time = initialTime,
	code = 'bucket_hash_mismatch',
	key = 'bucket-a',
	status: 'failed' | 'verified' = 'failed'
): HistoryArchiveObject {
	const value = new HistoryArchiveObject({
		archiveUrl: archiveRoot,
		archiveUrlIdentity: archiveRoot,
		bucketHash: 'a'.repeat(64),
		checkpointLedger: 63,
		objectKey: key,
		objectOrder: 63,
		objectType: 'bucket',
		objectUrl: `${archiveRoot}/bucket/a`,
		remoteId: `fixture-${key}`
	});
	value.status = status;
	value.errorType = status === 'failed' ? code : null;
	value.errorMessage =
		status === 'failed' ? 'RAW_DIAGNOSTIC_PRIVATE_MARKER' : null;
	value.httpStatus = null;
	Object.defineProperty(value, 'updatedAt', { value: time });
	return value;
}

export function fixture(source: DataSource) {
	const transport = new CapturingMailTransport(),
		exception = mock<ExceptionLogger>();
	const sources = mock<EventSourceService>();
	sources.isEventSourceIdKnown.mockResolvedValue(ok(true));
	sources.findEventSource.mockImplementation(async (id) =>
		ok(new EventSource(id, 'Fixture archive node'))
	);
	const creator = new EJSMessageCreator(
		'https://frontend.fixture.invalid',
		sources
	);
	const subscribers = new TypeOrmSubscriberRepository(
		source.getRepository(Subscriber)
	);
	const objects = mock<HistoryArchiveObjectRepository>(),
		nodes = mock<NodeRepository>();
	const key = NodeKey.create(fixtureNode.value);
	if (key.isErr()) throw key.error;
	const node = Node.create(initialTime, key.value, {
		ip: '192.0.2.1',
		port: 11625
	});
	node.updateDetails(
		NodeDetails.create({
			host: null,
			name: 'Fixture node',
			historyUrl: archiveRoot,
			alias: null
		}),
		initialTime
	);
	nodes.findAllKnown.mockResolvedValue([node]);
	const repository = new PgArchiveFindingStateRepository(source);
	const makeService = (database = source) =>
		new NotifyHistoryArchiveIntegrityFailures(
			objects,
			nodes,
			new TypeOrmSubscriberRepository(database.getRepository(Subscriber)),
			new Notifier(transport, creator),
			new HistoryArchiveIntegrityNotificationRunLock(database),
			mock<Logger>(),
			exception,
			database === source
				? repository
				: new PgArchiveFindingStateRepository(database)
		);
	const subscribe = async () => {
		const result = await new Subscribe(
			creator,
			new EventSourceIdFactory(sources),
			subscribers,
			transport
		).execute({
			time: initialTime,
			emailAddress: fixtureEmail,
			eventSourceIds: [{ type: 'node', id: fixtureNode.value }]
		});
		if (result.isErr()) throw result.error;
	};
	const confirm = async () => {
		const subscriber = await subscribers.findOneByUserId(fixtureUser);
		if (!subscriber?.pendingSubscription)
			throw new Error('Missing fixture confirmation');
		const result = await new ConfirmSubscription(subscribers).execute({
			pendingSubscriptionId:
				subscriber.pendingSubscription.pendingSubscriptionId.value
		});
		if (result.isErr()) throw result.error;
	};
	const run = async (values: HistoryArchiveObject[], database = source) => {
		// Model the real actionable query's failed-only selection, including verified recovery.
		objects.findActionableByArchiveUrl.mockResolvedValue(
			values.filter((value) => value.status === 'failed')
		);
		return makeService(database).execute();
	};
	const unsubscribe = async () => {
		const subscriber = await subscribers.findOneByUserId(fixtureUser);
		if (!subscriber) throw new Error('Missing fixture subscriber');
		const result = await new Unsubscribe(
			subscribers,
			transport,
			exception
		).execute({ subscriberReference: subscriber.subscriberReference.value });
		if (result.isErr()) throw result.error;
	};
	const unmute = async () => {
		const subscriber = await subscribers.findOneByUserId(fixtureUser);
		if (!subscriber) throw new Error('Missing fixture subscriber');
		const result = await new UnmuteNotification(
			subscribers,
			new EventSourceIdFactory(sources)
		).execute({
			subscriberReference: subscriber.subscriberReference.value,
			eventSourceType: 'node',
			eventSourceId: fixtureNode.value,
			eventType: EventType.HistoryArchiveErrorDetected
		});
		if (result.isErr()) throw result.error;
	};
	return {
		source,
		transport,
		subscribers,
		repository,
		subscribe,
		confirm,
		run,
		unsubscribe,
		unmute,
		activate: async () => {
			await subscribe();
			await confirm();
		}
	};
}
