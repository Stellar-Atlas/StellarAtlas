import type { DataSource } from 'typeorm';
import { EventType } from '../../../domain/event/Event.js';
import { archiveFinding } from '../../../domain/subscription/ArchiveFindingState.js';
import { fixtureUser } from '../../../use-cases/notify-history-archive-integrity/__fixtures__/CurrentNotificationStore.js';
import {
	event,
	fixture,
	initialTime,
	object,
	openDatabase,
	resetDatabase
} from './ArchiveFindingDbFixture.js';

const databaseTests =
	process.env.EMAIL001_ISOLATED_PG === '1' ? describe : describe.skip;
const after = (milliseconds: number) =>
	new Date(initialTime.getTime() + milliseconds);
const day = 24 * 60 * 60 * 1000;

databaseTests('legacy archive notification cutover', () => {
	let source: DataSource, f: ReturnType<typeof fixture>;
	jest.setTimeout(30_000);
	beforeAll(async () => {
		source = await openDatabase();
	});
	beforeEach(async () => {
		if (!source.isInitialized) source = await openDatabase();
		await resetDatabase(source);
		f = fixture(source);
		await f.activate();
		// Model successful legacy notification bookkeeping, not a durable finding ACK.
		await source.query(
			`INSERT INTO subscription_event_notification_state ("eventSubscriptionId", "eventType", "latestSendTime", "ignoreCoolOffPeriod") SELECT id, $1, $2, false FROM subscription`,
			[EventType.HistoryArchiveErrorDetected, initialTime]
		);
		expect(await states()).toEqual([]);
	});
	afterEach(() => jest.restoreAllMocks());
	afterAll(async () => {
		if (source?.isInitialized) await source.destroy();
	});
	async function states() {
		return source.query<Record<string, unknown>[]>(
			'SELECT * FROM archive_integrity_notification_state ORDER BY "findingKey"'
		);
	}
	async function legacy() {
		return source.query<Record<string, unknown>[]>(
			'SELECT "latestSendTime", "ignoreCoolOffPeriod" FROM subscription_event_notification_state'
		);
	}
	function expectUndelivered(rows: Record<string, unknown>[]) {
		expect(rows).not.toHaveLength(0);
		for (const row of rows) {
			expect(row.deliveredFingerprint).toBeNull();
			expect(row.deliveredObservationAt).toBeNull();
			expect(row.deliveredAt).toBeNull();
			expect(row.acknowledgedGeneration).toBeNull();
		}
	}

	it('does not resend at activation and persists observation without manufactured delivery', async () => {
		expect((await f.run([object()])).isOk()).toBe(true);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
		expect((await states())[0]?.observedAt).toEqual(initialTime);
		expect((await legacy())[0]?.latestSendTime).toEqual(initialTime);
		const changed = object(after(1));
		changed.bucketHash = 'b'.repeat(64);
		await f.run([changed]);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
	});

	it('keeps strict equality and allows a current observation beyond the legacy boundary', async () => {
		await f.run([object(after(day - 1))]);
		await f.run([object(after(day))]);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
		await f.run([object(after(day + 1))]);
		expect(f.transport.alerts).toHaveLength(1);
		expect((await states())[0]?.deliveredObservationAt).toEqual(after(day + 1));
		expect((await states())[0]?.deliveredFingerprint).toBe(
			archiveFinding(event(after(day + 1))).fingerprint
		);
		expect((await legacy())[0]?.latestSendTime).toEqual(after(day + 1));
		await f.run([object(after(day + 1))]);
		expect(f.transport.alerts).toHaveLength(1);
	});

	it('retains the cutoff and undelivered state on failed send, then retries after repository reload', async () => {
		const time = after(day + 1);
		f.transport.failNext = true;
		await f.run([object(time)]);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
		expect((await legacy())[0]?.latestSendTime).toEqual(initialTime);
		await source.destroy();
		source = await openDatabase();
		await f.run([object(time)], source);
		expect(f.transport.alerts).toHaveLength(1);
		expect((await states())[0]?.deliveredObservationAt).toEqual(time);
		await f.run([object(time)], source);
		expect(f.transport.alerts).toHaveLength(1);
	});

	it('ends only the legacy gate after a real ACK without delaying new keys or changed fingerprints', async () => {
		await f.run([object(after(day + 1))]);
		const changed = object(after(day + 2));
		changed.bucketHash = 'b'.repeat(64);
		await f.run([changed]);
		await f.run([object(after(day + 3), 'bucket_hash_mismatch', 'bucket-b')]);
		expect(f.transport.alerts).toHaveLength(3);
		expect(
			(await states()).every((row) => row.deliveredFingerprint !== null)
		).toBe(true);
		await f.run([object(after(day + 4), 'bucket_hash_mismatch', 'bucket-b')]);
		expect(f.transport.alerts).toHaveLength(3);
	});

	it('retains explicit unmute through failure and consumes it only on the real successful ACK', async () => {
		await f.run([object()]);
		await f.unmute();
		f.transport.failNext = true;
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
		expect((await legacy())[0]?.ignoreCoolOffPeriod).toBe(true);
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(1);
		expect((await legacy())[0]?.ignoreCoolOffPeriod).toBe(false);
		expect((await states())[0]?.deliveredObservationAt).toEqual(initialTime);
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(1);
	});

	it('does not turn elapsed wall time or suppressed preparation into a fake delivery', async () => {
		const now = jest
			.spyOn(Date, 'now')
			.mockReturnValue(after(365 * day).getTime());
		await f.repository.prepare(fixtureUser.value, [archiveFinding(event())]);
		await f.run([object()]);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
		now.mockRestore();
		await f.run([object(after(day + 1))]);
		expect(f.transport.alerts).toHaveLength(1);
	});

	it('uses the latest legacy timestamp across duplicate source-state rows', async () => {
		await source.query(
			`INSERT INTO subscription_event_notification_state ("eventSubscriptionId", "eventType", "latestSendTime", "ignoreCoolOffPeriod") SELECT id, $1, $2, false FROM subscription`,
			[EventType.HistoryArchiveErrorDetected, after(day)]
		);
		await f.run([object(after(day + 1))]);
		await f.run([object(after(2 * day))]);
		expect(f.transport.alerts).toHaveLength(0);
		expectUndelivered(await states());
		await f.run([object(after(2 * day + 1))]);
		expect(f.transport.alerts).toHaveLength(1);
	});
});
