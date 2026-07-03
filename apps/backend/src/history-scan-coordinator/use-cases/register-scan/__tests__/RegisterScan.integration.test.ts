import Kernel from '@core/infrastructure/Kernel.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Url } from 'http-helper';
import { ScanDTO } from 'history-scanner-dto';
import type { ScanJobRepository } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import type { Repository } from 'typeorm';
import {
	CommunityScanner,
	ScannerStatus
} from '@history-scan-coordinator/infrastructure/database/entities/CommunityScanner.js';
import { hashCommunityScannerApiKey } from '@history-scan-coordinator/domain/CommunityScannerApiKey.js';

jest.setTimeout(60000);

describe('RegisterScan.integration', () => {
	let kernel: Kernel;
	let registerScan: RegisterScan;
	let scanRepository: ScanRepository;
	let scanJobRepository: ScanJobRepository;
	let scannerRepository: Repository<CommunityScanner>;

	beforeAll(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		registerScan = kernel.container.get(RegisterScan);
		scanRepository = kernel.container.get<ScanRepository>(
			TYPES.HistoryArchiveScanRepository
		);
		scanJobRepository = kernel.container.get<ScanJobRepository>(
			TYPES.ScanJobRepository
		);
		scannerRepository = kernel.container.get<Repository<CommunityScanner>>(
			TYPES.CommunityScannerRepository
		);
	});

	afterAll(async () => {
		await kernel?.close();
	});

	it('should register a new scan successfully', async () => {
		const urlResult = Url.create('http://example.com');
		const scanJob = new ScanJob(urlResult._unsafeUnwrap().value);
		await scanJobRepository.save([scanJob]);

		if (urlResult.isErr()) throw urlResult.error;

		const dto: ScanDTO = {
			startDate: new Date(),
			endDate: new Date(),
			fromLedger: 1,
			toLedger: 100,
			error: {
				type: 'TYPE_VERIFICATION',
				message: 'Invalid URL',
				url: 'http://example.com/error'
			},
			errors: [
				{
					type: 'TYPE_VERIFICATION',
					message: 'Invalid URL',
					url: 'http://example.com/error'
				}
			],
			baseUrl: urlResult.value.value,
			scanChainInitDate: new Date(),
			latestVerifiedLedger: 100,
			latestScannedLedger: 100,
			latestScannedLedgerHeaderHash: null,
			concurrency: 5,
			isSlowArchive: false,
			scanJobRemoteId: scanJob.remoteId
		};

		const result = await registerScan.execute(dto);
		expect(result.isOk()).toBe(true);

		if (result.isOk()) {
			// Confirm persisted
			const scanInDb =
				await scanRepository.findLatestByUrl('http://example.com');
			expect(scanInDb).toBeDefined();
			expect(scanInDb?.baseUrl.value).toBe('http://example.com');

			const job = await scanJobRepository.findByRemoteId(scanJob.remoteId);
			expect(job).toBeDefined();
			expect(job?.status).toBe('DONE');
		}
	});

	it('should attribute community scanner scans and update scanner metrics', async () => {
		const savedScanner = await scannerRepository.save(
			scannerRepository.create({
				name: 'Archive Desk',
				contactEmail: 'archive-desk@example.com',
				apiKeyHash: hashCommunityScannerApiKey('satlas_scanner_secret'),
				status: ScannerStatus.ONLINE
			})
		);
		const urlResult = Url.create('http://scanner.example.com');
		if (urlResult.isErr()) throw urlResult.error;

		const scanJob = new ScanJob(urlResult.value.value);
		scanJob.status = 'TAKEN';
		scanJob.claimedByCommunityScannerId = savedScanner.id;
		scanJob.claimedAt = new Date('2026-07-03T12:00:00.000Z');
		await scanJobRepository.save([scanJob]);

		const dto: ScanDTO = {
			startDate: new Date('2026-07-03T12:00:01.000Z'),
			endDate: new Date('2026-07-03T12:00:06.000Z'),
			fromLedger: 1,
			toLedger: 100,
			error: {
				type: 'TYPE_VERIFICATION',
				message: 'Invalid bucket hash',
				url: 'http://scanner.example.com/.well-known/stellar-history.json'
			},
			errors: [
				{
					type: 'TYPE_VERIFICATION',
					message: 'Invalid bucket hash',
					url: 'http://scanner.example.com/.well-known/stellar-history.json'
				}
			],
			baseUrl: urlResult.value.value,
			scanChainInitDate: new Date('2026-07-03T12:00:01.000Z'),
			latestVerifiedLedger: 100,
			latestScannedLedger: 100,
			latestScannedLedgerHeaderHash: null,
			concurrency: 5,
			isSlowArchive: false,
			scanJobRemoteId: scanJob.remoteId
		};

		const result = await registerScan.execute(dto, {
			communityScannerId: savedScanner.id
		});
		expect(result.isOk()).toBe(true);

		const scanInDb = await scanRepository.findLatestByUrl(
			'http://scanner.example.com'
		);
		expect(scanInDb?.communityScannerId).toBe(savedScanner.id);
		expect(scanInDb?.scanJobRemoteId).toBe(scanJob.remoteId);

		const job = await scanJobRepository.findByRemoteId(scanJob.remoteId);
		expect(job?.status).toBe('DONE');

		const scannerInDb = await scannerRepository.findOneByOrFail({
			id: savedScanner.id
		});
		expect(Number(scannerInDb.totalJobsCompleted)).toBe(1);
		expect(Number(scannerInDb.totalJobsFailed)).toBe(0);
		expect(Number(scannerInDb.averageCompletionTimeMs)).toBe(6000);
	});
});
