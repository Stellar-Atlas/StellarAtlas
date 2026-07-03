import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { GetScannerMetrics } from '../GetScannerMetrics.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../../infrastructure/database/entities/CommunityScanner.js';
import { ScanJob } from '../../domain/ScanJob.js';

jest.setTimeout(30000);

describe('GetScannerMetrics.integration', () => {
	let kernel: Kernel;
	let dataSource: DataSource;
	let useCase: GetScannerMetrics;

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		dataSource = kernel.container.get(DataSource);
		useCase = kernel.container.get(GetScannerMetrics);
	});

	afterEach(async () => {
		if (kernel !== undefined) await kernel.close();
	});

	it('should expose aggregate claim-denial and eligibility metrics', async () => {
		const now = new Date();
		await saveScanner({ name: 'Eligible', totalJobsCompleted: 5 });
		const activeLimitedScannerId = await saveScanner({
			name: 'Active limited',
			totalJobsCompleted: 5
		});
		await saveActiveJob(activeLimitedScannerId);
		await saveScanner({
			name: 'Low score',
			successRate: 40,
			totalJobsCompleted: 2,
			totalJobsFailed: 3
		});
		await saveScanner({ name: 'Probationary' });
		await saveScanner({ name: 'Permanent block', isBlacklisted: true });
		await saveScanner({
			name: 'Temporary block',
			blacklistedUntil: new Date(now.getTime() + 60 * 60 * 1000)
		});
		const staleActiveScannerId = await saveScanner({
			name: 'Stale active',
			totalJobsCompleted: 5
		});
		await saveActiveJob(staleActiveScannerId, new Date(0));

		const result = await useCase.execute();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			totalScanners: 7,
			blacklistedScanners: 2,
			permanentlyBlacklistedScanners: 1,
			temporarilyBlockedScanners: 1,
			claimDeniedByBlockedScanners: 2,
			claimDeniedByActiveJobLimitScanners: 1,
			claimDeniedByProductionScoreScanners: 1,
			claimIneligibleScanners: 4,
			probationaryScanners: 1,
			claimEligibleScanners: 3,
			claimPolicyMaxActiveJobsPerScanner: 1,
			claimPolicyMinJobsForProductionScore: 5,
			claimPolicyMinSuccessRate: 50,
			staleScanJobAgeMs: 1800000
		});
	});

	async function saveScanner(
		overrides: Partial<CommunityScanner>
	): Promise<string> {
		const scannerRepository = dataSource.getRepository(CommunityScanner);
		const scanner = await scannerRepository.save(
			scannerRepository.create({
				name: overrides.name ?? 'Archive Desk',
				contactEmail: `${randomUUID()}@example.com`,
				apiKeyHash: `api-key-hash-${randomUUID()}`,
				status: ScannerStatus.ONLINE,
				successRate: 100,
				lastHeartbeatAt: new Date(),
				...overrides
			})
		);

		return scanner.id;
	}

	async function saveActiveJob(
		scannerId: string,
		updatedAt = new Date()
	): Promise<void> {
		const job = new ScanJob('https://archive.example.com');
		job.status = 'TAKEN';
		job.claimedByCommunityScannerId = scannerId;
		const savedJob = await dataSource.getRepository(ScanJob).save(job);
		await dataSource
			.getRepository(ScanJob)
			.createQueryBuilder()
			.update(ScanJob)
			.set({ updatedAt })
			.where('id = :id', { id: savedJob.id })
			.execute();
	}
});
