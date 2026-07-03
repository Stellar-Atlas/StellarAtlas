import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { TypeOrmScanJobRepository } from '../TypeOrmScanJobRepository.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
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
			expect(nextJob?.status).toBe('TAKEN');
			if (nextJob === null) {
				throw new Error('Expected a job to be claimed');
			}

			const persistedJob = await typeOrmScanJobRepository.findByRemoteId(
				nextJob.remoteId
			);
			expect(persistedJob?.status).toBe('TAKEN');
			expect(persistedJob?.claimedByCommunityScannerId).toBeNull();
			expect(persistedJob?.claimedAt).toBeInstanceOf(Date);
		});

		it('should return the fifo job for fetchNextJob when multiple jobs exist', async () => {
			const scanJob = new ScanJob('test1');
			const scanJob2 = new ScanJob('test2');
			await typeOrmScanJobRepository.save([scanJob, scanJob2]);
			const nextJob = await typeOrmScanJobRepository.fetchNextJob();
			expect(nextJob).toBeDefined();
			expect(nextJob?.url).toBe('test1');
		});

		it('should atomically claim distinct jobs for concurrent fetches', async () => {
			const scanJobs = Array.from(
				{ length: 8 },
				(_, index) => new ScanJob(`test-${index}`)
			);
			await typeOrmScanJobRepository.save(scanJobs);

			const nextJobs = await Promise.all(
				Array.from({ length: 8 }, () => typeOrmScanJobRepository.fetchNextJob())
			);

			const urls = nextJobs.map((job) => job?.url);
			expect(new Set(urls).size).toBe(8);
			expect(nextJobs.every((job) => job?.status === 'TAKEN')).toBe(true);
			expect(await typeOrmScanJobRepository.hasPendingJobs()).toBe(false);
		});

		it('should claim a pending job for a community scanner', async () => {
			const scannerId = randomUUID();
			await typeOrmScanJobRepository.save([new ScanJob('scanner-url')]);

			const nextJob =
				await typeOrmScanJobRepository.fetchNextJobForCommunityScanner(
					scannerId
				);

			expect(nextJob?.status).toBe('TAKEN');
			expect(nextJob?.claimedByCommunityScannerId).toBe(scannerId);
			expect(nextJob?.claimedAt).toBeInstanceOf(Date);
			if (nextJob === null) {
				throw new Error('Expected scanner job to be claimed');
			}

			const persistedJob = await typeOrmScanJobRepository.findByRemoteId(
				nextJob.remoteId
			);
			expect(persistedJob?.claimedByCommunityScannerId).toBe(scannerId);
			expect(persistedJob?.claimedAt).toBeInstanceOf(Date);
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

	describe('getQueueStats', () => {
		it('should count pending, active, and stale unfinished jobs', async () => {
			const pendingJob = new ScanJob('pending-url');
			const activeJob = new ScanJob('active-url');
			activeJob.status = 'TAKEN';
			const staleJob = new ScanJob('stale-url');
			staleJob.status = 'TAKEN';
			const finishedJob = new ScanJob('done-url');
			finishedJob.status = 'DONE';
			await typeOrmScanJobRepository.save([
				pendingJob,
				activeJob,
				staleJob,
				finishedJob
			]);

			await kernel.container
				.get(DataSource)
				.query(
					'update history_archive_scan_job_queue set "updatedAt" = $1 where url = $2',
					[new Date('2026-01-01T00:00:00.000Z'), staleJob.url]
				);

			const stats = await typeOrmScanJobRepository.getQueueStats(
				new Date('2026-01-02T00:00:00.000Z')
			);

			expect(stats).toEqual({
				pendingJobs: 1,
				activeJobs: 1,
				staleJobs: 1,
				totalUnfinishedJobs: 3
			});
		});
	});

	describe('getTakenJobsSnapshot', () => {
		it('should count and list taken jobs oldest heartbeat first', async () => {
			const activeJob = new ScanJob('active-url');
			activeJob.status = 'TAKEN';
			const staleJob = new ScanJob('stale-url');
			staleJob.status = 'TAKEN';
			const pendingJob = new ScanJob('pending-url');
			const finishedJob = new ScanJob('done-url');
			finishedJob.status = 'DONE';
			await typeOrmScanJobRepository.save([
				activeJob,
				staleJob,
				pendingJob,
				finishedJob
			]);

			await kernel.container
				.get(DataSource)
				.query(
					'update history_archive_scan_job_queue set "updatedAt" = $1 where url = $2',
					[new Date('2026-01-01T00:00:00.000Z'), staleJob.url]
				);

			const snapshot = await typeOrmScanJobRepository.getTakenJobsSnapshot(
				new Date('2026-01-02T00:00:00.000Z'),
				10
			);

			expect(snapshot.activeTakenJobs).toBe(1);
			expect(snapshot.staleTakenJobs).toBe(1);
			expect(snapshot.totalTakenJobs).toBe(2);
			expect(snapshot.jobs.map((job) => job.url)).toEqual([
				'stale-url',
				'active-url'
			]);
		});
	});

	describe('markTakenJobActive', () => {
		it('should refresh updatedAt only for a taken job', async () => {
			const scanJob = new ScanJob('active-url');
			scanJob.status = 'TAKEN';
			const pendingJob = new ScanJob('pending-url');
			await typeOrmScanJobRepository.save([scanJob, pendingJob]);

			const oldDate = new Date('2026-01-01T00:00:00.000Z');
			const dataSource = kernel.container.get(DataSource);
			await dataSource.query(
				'update history_archive_scan_job_queue set "updatedAt" = $1',
				[oldDate]
			);

			const wasUpdated = await typeOrmScanJobRepository.markTakenJobActive(
				scanJob.remoteId
			);
			const wasPendingUpdated =
				await typeOrmScanJobRepository.markTakenJobActive(pendingJob.remoteId);

			const refreshedJob = await typeOrmScanJobRepository.findByRemoteId(
				scanJob.remoteId
			);
			const untouchedJob = await typeOrmScanJobRepository.findByRemoteId(
				pendingJob.remoteId
			);

			expect(wasUpdated).toBe(true);
			expect(wasPendingUpdated).toBe(false);
			expect(refreshedJob?.updatedAt?.getTime()).toBeGreaterThan(
				oldDate.getTime()
			);
			expect(untouchedJob?.updatedAt?.toISOString()).toBe(
				oldDate.toISOString()
			);
		});

		it('should refresh only scanner-owned taken jobs', async () => {
			const scannerId = randomUUID();
			const otherScannerId = randomUUID();
			const scanJob = new ScanJob('scanner-owned-url');
			scanJob.status = 'TAKEN';
			scanJob.claimedByCommunityScannerId = scannerId;
			const otherJob = new ScanJob('other-scanner-url');
			otherJob.status = 'TAKEN';
			otherJob.claimedByCommunityScannerId = otherScannerId;
			await typeOrmScanJobRepository.save([scanJob, otherJob]);

			const oldDate = new Date('2026-01-01T00:00:00.000Z');
			const dataSource = kernel.container.get(DataSource);
			await dataSource.query(
				'update history_archive_scan_job_queue set "updatedAt" = $1',
				[oldDate]
			);

			const wasUpdated =
				await typeOrmScanJobRepository.markTakenJobActiveForCommunityScanner(
					scanJob.remoteId,
					scannerId
				);
			const wasOtherScannerUpdated =
				await typeOrmScanJobRepository.markTakenJobActiveForCommunityScanner(
					otherJob.remoteId,
					scannerId
				);

			const refreshedJob = await typeOrmScanJobRepository.findByRemoteId(
				scanJob.remoteId
			);
			const untouchedJob = await typeOrmScanJobRepository.findByRemoteId(
				otherJob.remoteId
			);

			expect(wasUpdated).toBe(true);
			expect(wasOtherScannerUpdated).toBe(false);
			expect(refreshedJob?.updatedAt?.getTime()).toBeGreaterThan(
				oldDate.getTime()
			);
			expect(untouchedJob?.updatedAt?.toISOString()).toBe(
				oldDate.toISOString()
			);
		});
	});

	describe('releaseStaleTakenJobs', () => {
		it('should release taken jobs older than the cutoff', async () => {
			const staleJob = new ScanJob('stale-url');
			staleJob.status = 'TAKEN';
			staleJob.claimedByCommunityScannerId = randomUUID();
			staleJob.claimedAt = new Date('2026-01-01T00:00:00.000Z');
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
			expect(releasedJob?.claimedByCommunityScannerId).toBeNull();
			expect(releasedJob?.claimedAt).toBeNull();
			expect(stillTakenJob?.status).toBe('TAKEN');
		});
	});
});
