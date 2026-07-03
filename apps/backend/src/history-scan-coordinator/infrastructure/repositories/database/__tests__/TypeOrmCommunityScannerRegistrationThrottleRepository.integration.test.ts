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
});
