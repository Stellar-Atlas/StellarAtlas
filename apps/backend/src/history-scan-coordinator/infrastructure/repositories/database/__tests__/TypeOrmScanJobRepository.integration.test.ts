import Kernel from '../../../../../core/infrastructure/Kernel.js';
import { ConfigMock } from '../../../../../core/config/__mocks__/configMock.js';
import { TypeOrmScanJobRepository } from '../TypeOrmScanJobRepository.js';
import { ScanJob } from '../../../../domain/ScanJob.js';
import { TYPES } from '../../../di/di-types.js';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

jest.setTimeout(30000);

describe('TypeOrmScanJobRepository.integration', () => {
	let kernel: Kernel;
	let typeOrmScanJobRepository: TypeOrmScanJobRepository;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		typeOrmScanJobRepository = kernel.container.get<TypeOrmScanJobRepository>(
			TYPES.ScanJobRepository
		);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
	});

	it('should load the repository without errors', async () => {
		expect(typeOrmScanJobRepository).toBeDefined();
	});

	describe('fetchNextJob', () => {
		it('should return null for fetchNextJob when no jobs exist', async () => {
			const nextJob = await typeOrmScanJobRepository.fetchNextJob();
			expect(nextJob).toBeNull();
		});

		it('should return a job for fetchNextJob when a job exists', async () => {
			const scanJob = new ScanJob('test');
			await typeOrmScanJobRepository.save([scanJob]);
			const nextJob = await typeOrmScanJobRepository.fetchNextJob();
			expect(nextJob).toBeDefined();
			expect(nextJob?.url).toBe('test');
		});

		it('should return the fifo job for fetchNextJob when multiple jobs exist', async () => {
			const scanJob = new ScanJob('test1');
			const scanJob2 = new ScanJob('test2');
			await typeOrmScanJobRepository.save([scanJob, scanJob2]);
			const nextJob = await typeOrmScanJobRepository.fetchNextJob();
			expect(nextJob).toBeDefined();
			expect(nextJob?.url).toBe('test1');
		});
	});

	describe('hasPendingJobs', () => {
		it('should indicate false on hasPendingJobs with no existing jobs', async () => {
			const hasPending = await typeOrmScanJobRepository.hasPendingJobs();
			expect(hasPending).toBe(false);
		});

		it('should indicate true on hasPendingJobs with existing jobs', async () => {
			const scanJob = new ScanJob('test');
			await typeOrmScanJobRepository.save([scanJob]);
			const hasPending = await typeOrmScanJobRepository.hasPendingJobs();
			expect(hasPending).toBe(true);
		});
	});

	describe('findByRemoteId', () => {
		it('should return null if no job with matching remoteId exists', async () => {
			const uuid = randomUUID();
			const job = await typeOrmScanJobRepository.findByRemoteId(uuid);
			expect(job).toBeNull();
		});

		it('should return the job if found by remoteId', async () => {
			const scanJob = new ScanJob('test-url');
			await typeOrmScanJobRepository.save([scanJob]);

			const threeDaysAgo = new Date();
			threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

			const jobs =
				await typeOrmScanJobRepository.findUnfinishedJobs(threeDaysAgo);
			if (jobs.length !== 1) {
				throw new Error('Expected one job to be found');
			}

			const job = await typeOrmScanJobRepository.findByRemoteId(
				jobs[0].remoteId
			);
			expect(job).toBeDefined();
			expect(job?.url).toBe('test-url');
		});
	});

	describe('findUnfinishedJobs', () => {
		it('should find unfinished jobs after the given date', async () => {
			const scanJob = new ScanJob('test-url');
			const finishedJob = new ScanJob('test-url2');
			finishedJob.status = 'DONE';

			await typeOrmScanJobRepository.save([scanJob, finishedJob]);

			const threeDaysAgo = new Date();
			threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

			const jobs =
				await typeOrmScanJobRepository.findUnfinishedJobs(threeDaysAgo);
			expect(jobs).toHaveLength(1);
			expect(jobs[0].url).toBe('test-url');

			const noJobs = await typeOrmScanJobRepository.findUnfinishedJobs(
				new Date()
			);
			expect(noJobs).toHaveLength(0);
		});
	});

	describe('releaseStaleTakenJobs', () => {
		it('should release taken jobs older than the cutoff', async () => {
			const staleJob = new ScanJob('stale-url');
			staleJob.status = 'TAKEN';
			const recentJob = new ScanJob('recent-url');
			recentJob.status = 'TAKEN';
			await typeOrmScanJobRepository.save([staleJob, recentJob]);

			const staleDate = new Date('2026-01-01T00:00:00.000Z');
			await kernel.container
				.get(DataSource)
				.query(
					'update history_archive_scan_job_queue set "updatedAt" = $1 where url = $2',
					[staleDate, staleJob.url]
				);

			const released = await typeOrmScanJobRepository.releaseStaleTakenJobs(
				new Date('2026-01-02T00:00:00.000Z')
			);

			expect(released).toBe(1);
			const releasedJob = await typeOrmScanJobRepository.findByRemoteId(
				staleJob.remoteId
			);
			const stillTakenJob = await typeOrmScanJobRepository.findByRemoteId(
				recentJob.remoteId
			);
			expect(releasedJob?.status).toBe('PENDING');
			expect(stillTakenJob?.status).toBe('TAKEN');
		});
	});
});
