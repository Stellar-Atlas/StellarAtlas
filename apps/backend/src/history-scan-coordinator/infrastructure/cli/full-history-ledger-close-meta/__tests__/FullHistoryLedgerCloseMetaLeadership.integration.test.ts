import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { acquireFullHistoryLedgerCloseMetaLeadership } from '../FullHistoryLedgerCloseMetaLeadership.js';

jest.setTimeout(60_000);

describe('FullHistoryLedgerCloseMetaLeadership', () => {
	let first: DataSource;
	let postgres: DisposablePostgres;
	let second: DataSource;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		first = await new DataSource({
			type: 'postgres',
			url: postgres.url
		}).initialize();
		second = await new DataSource({
			type: 'postgres',
			url: postgres.url
		}).initialize();
	});

	afterAll(async () => {
		if (first?.isInitialized) await first.destroy();
		if (second?.isInitialized) await second.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('fences concurrent leaders and detects a lost lock session', async () => {
		const leader = await acquireFullHistoryLedgerCloseMetaLeadership(first);
		const follower = await acquireFullHistoryLedgerCloseMetaLeadership(second);
		expect(leader.acquired).toBe(true);
		expect(follower.acquired).toBe(false);
		await expect(leader.assertHeld()).resolves.toBeUndefined();
		await expect(follower.assertHeld()).rejects.toThrow(/not held/i);
		await leader.release();
		await follower.release();

		const replacement =
			await acquireFullHistoryLedgerCloseMetaLeadership(second);
		expect(replacement.acquired).toBe(true);
		await expect(replacement.assertHeld()).resolves.toBeUndefined();
		await second.destroy();
		await expect(replacement.assertHeld()).rejects.toThrow();
		await replacement.release().catch(() => undefined);
	});
});
