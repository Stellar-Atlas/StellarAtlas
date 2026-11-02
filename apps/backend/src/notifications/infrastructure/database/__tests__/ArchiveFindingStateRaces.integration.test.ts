import type { DataSource } from 'typeorm';
import {
	archiveFinding,
	type ArchiveSourcePlan
} from '../../../domain/subscription/ArchiveFindingState.js';
import { HistoryArchiveIntegrityFailureDetectedEvent } from '../../../domain/event/Event.js';
import { PublicKey } from '../../../domain/event/EventSourceId.js';
import { TypeOrmSubscriberRepository } from '../repositories/TypeOrmSubscriberRepository.js';
import { fixtureUser } from '../../../use-cases/notify-history-archive-integrity/__fixtures__/CurrentNotificationStore.js';
import { date, queryRows } from '../ArchiveFindingSql.js';
import {
	event,
	fixture,
	initialTime,
	migration,
	object,
	openDatabase,
	queryMetrics,
	resetDatabase
} from './ArchiveFindingDbFixture.js';

const databaseTests =
	process.env.EMAIL001_ISOLATED_PG === '1' ? describe : describe.skip;
databaseTests('isolated PostgreSQL archive finding state', () => {
	let source: DataSource, f: ReturnType<typeof fixture>;
	jest.setTimeout(30_000);
	beforeAll(async () => {
		source = await openDatabase();
	});
	beforeEach(async () => {
		if (!source.isInitialized) source = await openDatabase();
		await resetDatabase(source);
		f = fixture(source);
	});
	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => {
		if (source?.isInitialized) await source.destroy();
	});
	async function rows(connection = source) {
		const runner = connection.createQueryRunner();
		await runner.connect();
		try {
			return await queryRows(
				runner,
				'SELECT * FROM archive_integrity_notification_state ORDER BY "findingKey"'
			);
		} finally {
			await runner.release();
		}
	}
	async function flag(): Promise<boolean> {
		const runner = source.createQueryRunner();
		await runner.connect();
		try {
			const values = await queryRows(
				runner,
				'SELECT "ignoreCoolOffPeriod" FROM subscription_event_notification_state'
			);
			return values.some((row) => row.ignoreCoolOffPeriod === true);
		} finally {
			await runner.release();
		}
	}

	it('rolls back partial acknowledgement and unmute consumption, then honestly permits retry', async () => {
		await f.activate();
		const both = [
			object(),
			object(initialTime, 'bucket_hash_mismatch', 'bucket-b')
		];
		const plans = await f.repository.prepare(
			fixtureUser.value,
			both.map((value) =>
				archiveFinding(
					event(initialTime, 'bucket_hash_mismatch', value.objectKey)
				)
			)
		);
		await source.query(
			'INSERT INTO subscription_event_notification_state ("eventSubscriptionId","eventType","latestSendTime","ignoreCoolOffPeriod") VALUES ($1,$2,$3,true)',
			[
				plans[0]?.subscriptionId,
				'HistoryArchiveErrorDetected',
				new Date(initialTime.getTime() - 1)
			]
		);
		const blocked = plans[0]?.findings.at(-1)?.key;
		if (!blocked || !/^[0-9a-f]{64}$/.test(blocked))
			throw new Error('Invalid synthetic constraint key');
		await source.query(
			`ALTER TABLE archive_integrity_notification_state ADD CONSTRAINT fixture_ack_failure CHECK ("findingKey" <> '${blocked}' OR "deliveredFingerprint" IS NULL)`
		);
		expect((await f.run(both)).isErr()).toBe(true);
		expect(f.transport.alerts).toHaveLength(1);
		expect(
			(await rows()).every((row) => row.deliveredFingerprint === null)
		).toBe(true);
		expect(await flag()).toBe(true);
		await source.query(
			'ALTER TABLE archive_integrity_notification_state DROP CONSTRAINT fixture_ack_failure'
		);
		await f.run(both);
		expect(f.transport.alerts).toHaveLength(2);
		expect(await flag()).toBe(false);
	});
	it('preserves pending opt-in and fresh-run unsubscribe with cascade', async () => {
		await f.subscribe();
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(0);
		expect(await rows()).toEqual([]);
		await f.confirm();
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(1);
		await f.unsubscribe();
		await f.run([object(new Date(initialTime.getTime() + 1))]);
		expect(f.transport.alerts).toHaveLength(1);
		expect(await rows()).toEqual([]);
	});
	it('cannot resurrect an unsubscribe after provider acceptance and never saves a stale aggregate', async () => {
		await f.activate();
		const send = f.transport.send.bind(f.transport);
		jest
			.spyOn(TypeOrmSubscriberRepository.prototype, 'save')
			.mockRejectedValue(new Error('Stale aggregate save forbidden'));
		jest
			.spyOn(f.transport, 'send')
			.mockImplementationOnce(async (id, message) => {
				const result = await send(id, message);
				await f.unsubscribe();
				return result;
			});
		expect((await f.run([object()])).isOk()).toBe(true);
		expect(f.transport.alerts).toHaveLength(1);
		expect(await rows()).toEqual([]);
		expect(await f.subscribers.find()).toEqual([]);
		await f.run([object(new Date(initialTime.getTime() + 1))]);
		expect(f.transport.alerts).toHaveLength(1);
	});
	it('does not send when unsubscribe wins after preparation but before transport', async () => {
		await f.activate();
		const prepare = f.repository.prepare.bind(f.repository);
		jest
			.spyOn(f.repository, 'prepare')
			.mockImplementationOnce(async (user, findings) => {
				const plans = await prepare(user, findings);
				await f.unsubscribe();
				return plans;
			});
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(0);
		expect(await rows()).toEqual([]);
		expect(await f.subscribers.find()).toEqual([]);
	});
	it('cannot resurrect deleted subscriptions while acknowledgement waits for their lock', async () => {
		await f.activate();
		const plans = await f.repository.prepare(fixtureUser.value, [
			archiveFinding(event())
		]);
		const holder = source.createQueryRunner();
		await holder.connect();
		await holder.startTransaction();
		try {
			await holder.query(
				'SELECT id FROM subscription WHERE id = $1 FOR UPDATE',
				[plans[0]?.subscriptionId]
			);
			const acknowledgement = f.repository.acknowledge(plans);
			await holder.query('DELETE FROM subscription WHERE id = $1', [
				plans[0]?.subscriptionId
			]);
			await holder.commitTransaction();
			await acknowledgement;
			expect(await rows()).toEqual([]);
			expect(await source.query('SELECT id FROM subscription')).toEqual([]);
		} finally {
			if (holder.isTransactionActive) await holder.rollbackTransaction();
			await holder.release();
		}
	});
	it('acknowledges old in-flight delivery without lowering newer observation or delivery state', async () => {
		await f.activate();
		const old = await f.repository.prepare(fixtureUser.value, [
			archiveFinding(event())
		]);
		const next = archiveFinding(
			event(new Date(initialTime.getTime() + 10), 'bucket_verification_failed')
		);
		const newer = await f.repository.prepare(fixtureUser.value, [next]);
		await f.repository.acknowledge(newer);
		await f.repository.acknowledge(old);
		expect((await rows())[0]?.deliveredFingerprint).toBe(next.fingerprint);
		expect(date((await rows())[0]?.observedAt)).toEqual(next.observedAt);
	});
	it('keeps verified recovery silent and does not reset retained failure acknowledgement', async () => {
		await f.activate();
		await f.run([object()]);
		await f.run([
			object(
				new Date(initialTime.getTime() + 1),
				'bucket_hash_mismatch',
				'bucket-a',
				'verified'
			)
		]);
		await f.run([object(new Date(initialTime.getTime() + 2))]);
		expect(f.transport.alerts).toHaveLength(1);
		await f.run([
			object(new Date(initialTime.getTime() + 3), 'bucket_verification_failed')
		]);
		expect(f.transport.alerts).toHaveLength(2);
	});
	it('does not acknowledge replaced source subscriptions after concurrent confirmation', async () => {
		await f.activate();
		const send = f.transport.send.bind(f.transport);
		jest
			.spyOn(f.transport, 'send')
			.mockImplementationOnce(async (id, message) => {
				const result = await send(id, message);
				await f.subscribe();
				await f.confirm();
				return result;
			});
		expect((await f.run([object()])).isOk()).toBe(true);
		expect(await rows()).toEqual([]);
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(2);
		expect(await rows()).toHaveLength(1);
	});
	it('holds no database transaction across provider delivery and serializes archive runs', async () => {
		await f.activate();
		const send = f.transport.send.bind(f.transport);
		let release: () => void = () => {
			throw new Error('Provider gate not initialized');
		};
		let entered: () => void = () => {
			throw new Error('Provider entry gate not initialized');
		};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const entry = new Promise<void>((resolve) => {
			entered = resolve;
		});
		jest
			.spyOn(f.transport, 'send')
			.mockImplementationOnce(async (id, message) => {
				entered();
				await gate;
				return send(id, message);
			});
		const firstRun = f.run([object()]);
		try {
			await entry;
			const runner = source.createQueryRunner();
			await runner.connect();
			try {
				expect(
					await runner.query(
						"SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'"
					)
				).toEqual([{ count: 0 }]);
			} finally {
				await runner.release();
			}
			const secondRun = await f.run([
				object(new Date(initialTime.getTime() + 1))
			]);
			expect(
				secondRun.isOk() && secondRun.value.skippedDueToConcurrentRun
			).toBe(true);
		} finally {
			release();
		}
		expect((await firstRun).isOk()).toBe(true);
		expect(f.transport.alerts).toHaveLength(1);
	});
	it('chunks current-key lookups and refuses oversized source/acknowledgement batches', async () => {
		await f.activate();
		const base = event(),
			candidates = [archiveFinding(base)];
		for (let index = 0; index < 400; index++) {
			const key = PublicKey.create('G' + index.toString(16).padStart(55, '0'));
			if (key.isErr()) throw key.error;
			candidates.push(
				archiveFinding(
					new HistoryArchiveIntegrityFailureDetectedEvent(
						initialTime,
						key.value,
						base.data
					)
				)
			);
		}
		queryMetrics.length = 0;
		await f.repository.prepare(fixtureUser.value, candidates);
		expect(
			queryMetrics.filter(
				(metric) =>
					metric.sql.includes('= ANY($2::text[])') &&
					metric.sql.includes('subscription_subscriber')
			)
		).toHaveLength(3);
		expect(
			queryMetrics.every((metric) =>
				metric.arrayLengths.every((length) => length <= 200)
			)
		).toBe(true);
		const tooMany = Array.from({ length: 101 }, (_, index) =>
			archiveFinding(
				event(initialTime, 'bucket_hash_mismatch', `bucket-${index}`)
			)
		);
		await expect(
			f.repository.prepare(fixtureUser.value, tooMany)
		).rejects.toThrow('limit');
		const plans = await f.repository.prepare(
			fixtureUser.value,
			tooMany.slice(0, 100)
		);
		const plan = plans[0];
		if (!plan) throw new Error('Missing bounded fixture plan');
		await expect(f.repository.acknowledge([plan, plan, plan])).rejects.toThrow(
			'batch'
		);
	});
});
