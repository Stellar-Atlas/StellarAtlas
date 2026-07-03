import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { DataSource } from 'typeorm';
import { TypeOrmCommunityScannerRegistrationThrottleRepository } from '../TypeOrmCommunityScannerRegistrationThrottleRepository.js';

jest.setTimeout(30000);

describe('TypeOrmCommunityScannerRegistrationThrottleRepository.integration', () => {
	let kernel: Kernel;
	let dataSource: DataSource;
	let repository: TypeOrmCommunityScannerRegistrationThrottleRepository;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		dataSource = kernel.container.get(DataSource);
		repository = new TypeOrmCommunityScannerRegistrationThrottleRepository(
			dataSource
		);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
	});

	it('should atomically count concurrent attempts in one source window', async () => {
		const sourceIpHash = 'a'.repeat(64);
		const now = new Date('2026-07-03T12:00:00.000Z');
		const windowMs = 60 * 60 * 1000;

		const snapshots = await Promise.all(
			Array.from({ length: 6 }, () =>
				repository.recordAttempt(sourceIpHash, now, windowMs)
			)
		);

		expect(Math.max(...snapshots.map((snapshot) => snapshot.attemptCount))).toBe(
			6
		);
		const rows = (await dataSource.query(
			`
			select source_ip_hash, attempt_count
			from community_scanner_registration_throttles
			where source_ip_hash = $1
			`,
			[sourceIpHash]
		)) as Array<{ attempt_count: number | string }>;
		expect(rows).toHaveLength(1);
		expect(Number(rows[0].attempt_count)).toBe(6);
	});

	it('should start a new attempt window after the previous window expires', async () => {
		const sourceIpHash = 'b'.repeat(64);
		const windowMs = 60 * 60 * 1000;

		await repository.recordAttempt(
			sourceIpHash,
			new Date('2026-07-03T12:00:00.000Z'),
			windowMs
		);
		const snapshot = await repository.recordAttempt(
			sourceIpHash,
			new Date('2026-07-03T13:00:01.000Z'),
			windowMs
		);

		expect(snapshot).toEqual({
			attemptCount: 1,
			windowStartedAt: new Date('2026-07-03T13:00:01.000Z')
		});
	});

	it('should delete stale attempts up to the cleanup limit', async () => {
		const staleOldestHash = 'c'.repeat(64);
		const staleNewestHash = 'd'.repeat(64);
		const freshHash = 'e'.repeat(64);
		await dataSource.query(
			`
			delete from community_scanner_registration_throttles
			where source_ip_hash in ($1, $2, $3)
			`,
			[staleOldestHash, staleNewestHash, freshHash]
		);
		await dataSource.query(
			`
			insert into community_scanner_registration_throttles (
				source_ip_hash,
				window_started_at,
				attempt_count,
				created_at,
				updated_at
			)
			values
				($1, $4, 1, $4, $4),
				($2, $5, 1, $5, $5),
				($3, $6, 1, $6, $6)
			`,
			[
				staleOldestHash,
				staleNewestHash,
				freshHash,
				new Date('2026-06-20T12:00:00.000Z'),
				new Date('2026-06-21T12:00:00.000Z'),
				new Date('2026-07-03T12:00:00.000Z')
			]
		);

		const deleted = await repository.deleteStaleAttempts(
			new Date('2026-06-26T12:00:00.000Z'),
			1
		);

		expect(deleted).toBe(1);
		const rows = (await dataSource.query(
			`
			select source_ip_hash
			from community_scanner_registration_throttles
			where source_ip_hash in ($1, $2, $3)
			order by source_ip_hash asc
			`,
			[staleOldestHash, staleNewestHash, freshHash]
		)) as Array<{ source_ip_hash: string }>;
		expect(rows.map((row) => row.source_ip_hash)).toEqual([
			staleNewestHash,
			freshHash
		]);
	});

	it('should ignore non-positive cleanup limits', async () => {
		const deleted = await repository.deleteStaleAttempts(
			new Date('2026-06-26T12:00:00.000Z'),
			0
		);

		expect(deleted).toBe(0);
	});
});
