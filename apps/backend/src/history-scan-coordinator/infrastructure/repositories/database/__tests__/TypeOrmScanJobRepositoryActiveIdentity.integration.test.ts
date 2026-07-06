import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { DataSource } from 'typeorm';
import { TypeOrmScanJobRepository } from '../TypeOrmScanJobRepository.js';

jest.setTimeout(30000);

describe('TypeOrmScanJobRepository active identity', () => {
	let kernel: Kernel | undefined;
	let repository: TypeOrmScanJobRepository;
	let dataSource: DataSource;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		repository = kernel.container.get<TypeOrmScanJobRepository>(
			TYPES.ScanJobRepository
		);
		dataSource = kernel.container.get(DataSource);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
		kernel = undefined;
	});

	it('should keep stale pending jobs unfinished and exclude stale taken jobs', async () => {
		const pendingJob = new ScanJob('https://pending-stale.example.com');
		const staleTakenJob = new ScanJob('https://taken-stale.example.com');
		staleTakenJob.status = 'TAKEN';
		const activeTakenJob = new ScanJob('https://taken-active.example.com');
		activeTakenJob.status = 'TAKEN';

		await repository.save([pendingJob, staleTakenJob, activeTakenJob]);
		await setUpdatedAt(pendingJob.url, new Date('2026-01-01T00:00:00.000Z'));
		await setUpdatedAt(staleTakenJob.url, new Date('2026-01-01T00:00:00.000Z'));

		const jobs = await repository.findUnfinishedJobs(
			new Date('2026-01-02T00:00:00.000Z')
		);
		const urls = jobs.map((job) => job.url);

		expect(urls).toContain(pendingJob.url);
		expect(urls).toContain(activeTakenJob.url);
		expect(urls).not.toContain(staleTakenJob.url);
	});

	it('should release only stale taken jobs', async () => {
		const pendingJob = new ScanJob('https://old-pending.example.com');
		const takenJob = new ScanJob('https://old-taken.example.com');
		takenJob.status = 'TAKEN';
		await repository.save([pendingJob, takenJob]);

		const oldDate = new Date('2026-01-01T00:00:00.000Z');
		await setUpdatedAt(pendingJob.url, oldDate);
		await setUpdatedAt(takenJob.url, oldDate);

		const released = await repository.releaseStaleTakenJobs(
			new Date('2026-01-02T00:00:00.000Z')
		);

		expect(released).toBe(1);
		expect((await repository.findByRemoteId(pendingJob.remoteId))?.status).toBe(
			'PENDING'
		);
		expect((await repository.findByRemoteId(takenJob.remoteId))?.status).toBe(
			'PENDING'
		);
	});

	it('should suppress duplicate active jobs with the same normalized identity', async () => {
		const firstJob = new ScanJob(
			'https://history.example.com/archive/',
			58551359,
			'header-hash',
			new Date('2026-07-01T00:00:00.000Z'),
			58551360,
			58762559,
			4
		);
		const duplicateJob = new ScanJob(
			'https://history.example.com/archive',
			58551359,
			'header-hash',
			new Date('2026-07-02T00:00:00.000Z'),
			58551360,
			58762559,
			24
		);

		await repository.save([firstJob, duplicateJob]);

		const rows = await findActiveRows('https://history.example.com/archive');
		expect(rows).toHaveLength(1);
		expect(rows[0]?.remoteId).toBe(firstJob.remoteId);
	});

	it('should suppress duplicate active jobs even when progress differs', async () => {
		const firstJob = new ScanJob(
			'https://history-progress.example.com/archive',
			58551359,
			'first-header-hash',
			new Date('2026-07-01T00:00:00.000Z'),
			58551360,
			58762559,
			4
		);
		const duplicateJob = new ScanJob(
			'https://history-progress.example.com/archive',
			58560000,
			'second-header-hash',
			new Date('2026-07-02T00:00:00.000Z'),
			58551360,
			58762559,
			24
		);

		await repository.save([firstJob, duplicateJob]);

		const rows = await findActiveRows(
			'https://history-progress.example.com/archive'
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.remoteId).toBe(firstJob.remoteId);
	});

	it('should suppress duplicate active jobs under concurrent saves', async () => {
		const url = 'https://history-race.example.com/archive';

		await Promise.all(
			Array.from({ length: 8 }, () =>
				repository.save([new ScanJob(url, 127, 'race-hash', null, 128, 255)])
			)
		);

		const rows = await findActiveRows(url);
		expect(rows).toHaveLength(1);
	});

	async function setUpdatedAt(url: string, updatedAt: Date): Promise<void> {
		await dataSource.query(
			'update history_archive_scan_job_queue set "updatedAt" = $1 where url = $2',
			[updatedAt, url]
		);
	}

	async function findActiveRows(
		url: string
	): Promise<Array<{ remoteId: string }>> {
		return (await dataSource.query(
			`
			select "remoteId"
			from history_archive_scan_job_queue
			where status in ('PENDING', 'TAKEN')
				and lower(regexp_replace(url, '/+$', '')) = lower($1)
			order by id asc
			`,
			[url]
		)) as Array<{ remoteId: string }>;
	}
});
