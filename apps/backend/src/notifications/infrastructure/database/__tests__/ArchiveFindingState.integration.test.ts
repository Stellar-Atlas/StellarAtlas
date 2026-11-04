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

	it('runs actual migration down/up and enforces indexed uniqueness, shape and cascade', async () => {
		await f.activate();
		const plans = await f.repository.prepare(fixtureUser.value, [
			archiveFinding(event())
		]);
		await f.repository.prepare(fixtureUser.value, [archiveFinding(event())]);
		expect(await rows()).toHaveLength(1);
		const runner = source.createQueryRunner();
		await runner.connect();
		try {
			await expect(
				runner.query(
					'INSERT INTO archive_integrity_notification_state ("subscriptionId","findingKey","observedFingerprint","observedAt") VALUES ($1,$2,$3,$4)',
					[plans[0]?.subscriptionId, 'invalid', 'a'.repeat(64), initialTime]
				)
			).rejects.toThrow();
			await migration.down(runner);
			expect(
				await runner.query(
					"SELECT to_regclass('archive_integrity_notification_state') AS relation"
				)
			).toEqual([{ relation: null }]);
			await migration.up(runner);
		} finally {
			await runner.release();
		}
		expect(await rows()).toEqual([]);
		await f.repository.prepare(fixtureUser.value, [archiveFinding(event())]);
		await f.unsubscribe();
		expect(await rows()).toEqual([]);
	});
	it('deduplicates advancing observations after the first pool closes and a new pool reloads', async () => {
		await f.activate();
		expect((await f.run([object()])).isOk()).toBe(true);
		await source.destroy();
		const fresh = await openDatabase();
		try {
			expect(
				(
					await f.run([object(new Date(initialTime.getTime() + 10))], fresh)
				).isOk()
			).toBe(true);
			expect(f.transport.alerts).toHaveLength(1);
			const state = (await rows(fresh))[0];
			expect(date(state?.observedAt).getTime()).toBe(
				initialTime.getTime() + 10
			);
			expect(date(state?.deliveredObservationAt).getTime()).toBe(
				initialTime.getTime()
			);
		} finally {
			await fresh.destroy();
		}
	});
	it('persists suppressed observation high-water marks and rejects delayed changed evidence', async () => {
		await f.activate();
		await f.run([object()]);
		await f.run([object(new Date(initialTime.getTime() + 10))]);
		await f.run([
			object(new Date(initialTime.getTime() + 5), 'bucket_verification_failed')
		]);
		expect(f.transport.alerts).toHaveLength(1);
		await f.run([
			object(new Date(initialTime.getTime() + 11), 'bucket_verification_failed')
		]);
		expect(f.transport.alerts).toHaveLength(2);
	});
	it('retains failed-send watermark without inventing acknowledgement and retries equal evidence', async () => {
		await f.activate();
		f.transport.failNext = true;
		const failed = await f.run([object(new Date(initialTime.getTime() + 10))]);
		expect(failed.isOk() && failed.value.failedNotifications).toBe(1);
		expect((await rows())[0]?.deliveredFingerprint).toBeNull();
		await f.run([
			object(new Date(initialTime.getTime() + 5), 'bucket_verification_failed')
		]);
		expect(f.transport.alerts).toHaveLength(0);
		await f.run([object(new Date(initialTime.getTime() + 10))]);
		expect(f.transport.alerts).toHaveLength(1);
	});
	it('fails closed on same-key equal-time conflicts until strictly newer evidence', async () => {
		await f.activate();
		await f.run([object()]);
		await f.run([object(initialTime, 'bucket_verification_failed')]);
		expect((await rows())[0]?.observationConflicted).toBe(true);
		expect(f.transport.alerts).toHaveLength(1);
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(1);
		await f.run([
			object(new Date(initialTime.getTime() + 1), 'bucket_verification_failed')
		]);
		expect(f.transport.alerts).toHaveLength(2);
		expect((await rows())[0]?.observationConflicted).toBe(false);
	});
	it('detects conflicts within one batch and independently includes distinct equal-time objects', async () => {
		await f.activate();
		await f.run([object(), object(initialTime, 'bucket_verification_failed')]);
		expect(f.transport.alerts).toHaveLength(0);
		await f.run([
			object(new Date(initialTime.getTime() + 1)),
			object(
				new Date(initialTime.getTime() + 1),
				'bucket_hash_mismatch',
				'bucket-b'
			)
		]);
		expect(f.transport.alerts).toHaveLength(1);
		expect(f.transport.alerts[0]?.body).toContain('Object: bucket-a');
		expect(f.transport.alerts[0]?.body).toContain('Object: bucket-b');
		expect(f.transport.alerts[0]?.body).not.toContain(
			'RAW_DIAGNOSTIC_PRIVATE_MARKER'
		);
	});
	it('keeps strict source-time cooldown equality and never schedules old-observation reminders', async () => {
		await f.activate();
		await f.run([object()]);
		await f.run([object(new Date(initialTime.getTime() + 86_400_000))]);
		expect(f.transport.alerts).toHaveLength(1);
		await f.run([object(new Date(initialTime.getTime() + 86_400_001))]);
		expect(f.transport.alerts).toHaveLength(2);
	});
	it('does not remind for an identical observation from years ago', async () => {
		await f.activate();
		const past = new Date('2020-01-01T00:00:00Z');
		await f.run([object(past)]);
		await f.run([object(past)]);
		expect(f.transport.alerts).toHaveLength(1);
	});
	it('coalesces one source-level unmute into one aggregate and retains intent on transport failure', async () => {
		await f.activate();
		const both = [
			object(),
			object(initialTime, 'bucket_hash_mismatch', 'bucket-b')
		];
		await f.run(both);
		await f.unmute();
		f.transport.failNext = true;
		await f.run(both);
		expect(await flag()).toBe(true);
		expect(f.transport.alerts).toHaveLength(1);
		await f.run(both);
		expect(f.transport.alerts).toHaveLength(2);
		expect(await flag()).toBe(false);
		expect(f.transport.alerts[1]?.body).toContain('Object: bucket-b');
		await f.run(both);
		expect(f.transport.alerts).toHaveLength(2);
	});
	it('replayed acknowledgement cannot consume an intent requested after its first commit', async () => {
		await f.activate();
		await f.run([object()]);
		await f.unmute();
		const plans = await f.repository.prepare(fixtureUser.value, [
			archiveFinding(event())
		]);
		await f.repository.acknowledge(plans);
		expect(await flag()).toBe(false);
		await f.unmute();
		await f.repository.acknowledge(plans);
		expect(await flag()).toBe(true);
		await f.run([object()]);
		expect(await flag()).toBe(false);
	});
	it('rejects an old acknowledgement after an intervening same-observation forced resend', async () => {
		await f.activate();
		await f.run([object()]);
		await f.unmute();
		const old = await f.repository.prepare(fixtureUser.value, [
			archiveFinding(event())
		]);
		await f.repository.acknowledge(old);
		await f.unmute();
		const newer = await f.repository.prepare(fixtureUser.value, [
			archiveFinding(event())
		]);
		await f.repository.acknowledge(newer);
		expect(await flag()).toBe(false);
		await f.unmute();
		await f.repository.acknowledge(old);
		expect(await flag()).toBe(true);
	});
	it('cannot acknowledge a newer reservation using an older in-flight plan', async () => {
		await f.activate();
		const finding = archiveFinding(event());
		const old = await f.repository.prepare(fixtureUser.value, [finding]);
		const newer = await f.repository.prepare(fixtureUser.value, [finding]);
		await f.repository.acknowledge(old);
		expect((await rows())[0]?.deliveredObservationAt).toBeNull();
		await f.repository.acknowledge(newer);
		expect((await rows())[0]?.deliveredObservationAt).toEqual(initialTime);
	});
	it('does not consume unmute requested after a false preparation snapshot', async () => {
		await f.activate();
		await f.run([object()]);
		const next = archiveFinding(
			event(new Date(initialTime.getTime() + 1), 'bucket_verification_failed')
		);
		const plans = await f.repository.prepare(fixtureUser.value, [next]);
		expect(plans[0]?.unmute).toHaveLength(0);
		await f.unmute();
		await f.repository.acknowledge(plans);
		expect(await flag()).toBe(true);
	});
});
