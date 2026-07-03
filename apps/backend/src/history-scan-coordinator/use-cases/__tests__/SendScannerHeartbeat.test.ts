import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import {
	CommunityScannerBlacklistedError,
	CommunityScannerNotFoundError,
	InvalidCommunityScannerApiKeyError,
	SendScannerHeartbeat
} from '../SendScannerHeartbeat.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../../infrastructure/database/entities/CommunityScanner.js';
import { Repository } from 'typeorm';
import { hashCommunityScannerApiKey } from '../../domain/CommunityScannerApiKey.js';

describe('SendScannerHeartbeat', () => {
	let useCase: SendScannerHeartbeat;
	let scannerRepositoryMock: MockProxy<Repository<CommunityScanner>>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scannerRepositoryMock = mock<Repository<CommunityScanner>>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		useCase = new SendScannerHeartbeat(
			scannerRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	const apiKey = 'satlas_scanner_valid-token';
	const validRequest = {
		scannerId: 'scanner-uuid',
		apiKey
	};

	it('should update heartbeat for a valid scanner without exposing the key', async () => {
		const scanner = new CommunityScanner();
		scanner.id = validRequest.scannerId;
		scanner.apiKeyHash = hashCommunityScannerApiKey(apiKey);
		scanner.status = ScannerStatus.PENDING;
		scanner.isBlacklisted = false;
		scannerRepositoryMock.findOne.mockResolvedValue(scanner);
		scannerRepositoryMock.save.mockImplementation(async (savedScanner) => {
			return savedScanner as CommunityScanner;
		});

		const result = await useCase.execute(validRequest);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			id: validRequest.scannerId,
			lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
			status: ScannerStatus.ONLINE
		});
		expect(scannerRepositoryMock.save).toHaveBeenCalledWith(
			expect.objectContaining({
				id: validRequest.scannerId,
				lastHeartbeatAt: new Date('2026-07-03T12:00:00.000Z'),
				status: ScannerStatus.ONLINE
			})
		);
	});

	it('should keep degraded status until a performance job changes it', async () => {
		const scanner = new CommunityScanner();
		scanner.id = validRequest.scannerId;
		scanner.apiKeyHash = hashCommunityScannerApiKey(apiKey);
		scanner.status = ScannerStatus.DEGRADED;
		scanner.isBlacklisted = false;
		scannerRepositoryMock.findOne.mockResolvedValue(scanner);
		scannerRepositoryMock.save.mockImplementation(async (savedScanner) => {
			return savedScanner as CommunityScanner;
		});

		const result = await useCase.execute(validRequest);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe(ScannerStatus.DEGRADED);
	});

	it('should return not found for unknown scanners', async () => {
		scannerRepositoryMock.findOne.mockResolvedValue(null);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(
			CommunityScannerNotFoundError
		);
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should reject invalid API keys without saving', async () => {
		const scanner = new CommunityScanner();
		scanner.id = validRequest.scannerId;
		scanner.apiKeyHash = hashCommunityScannerApiKey('different-key');
		scannerRepositoryMock.findOne.mockResolvedValue(scanner);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(
			InvalidCommunityScannerApiKeyError
		);
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should reject blacklisted scanners after successful authentication', async () => {
		const scanner = new CommunityScanner();
		scanner.id = validRequest.scannerId;
		scanner.apiKeyHash = hashCommunityScannerApiKey(apiKey);
		scanner.isBlacklisted = true;
		scannerRepositoryMock.findOne.mockResolvedValue(scanner);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(
			CommunityScannerBlacklistedError
		);
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should reject temporarily blocked scanners after authentication', async () => {
		const scanner = new CommunityScanner();
		scanner.id = validRequest.scannerId;
		scanner.apiKeyHash = hashCommunityScannerApiKey(apiKey);
		scanner.blacklistedUntil = new Date('2026-07-03T12:05:00.000Z');
		scannerRepositoryMock.findOne.mockResolvedValue(scanner);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(
			CommunityScannerBlacklistedError
		);
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should accept scanners after a temporary block expires', async () => {
		const scanner = new CommunityScanner();
		scanner.id = validRequest.scannerId;
		scanner.apiKeyHash = hashCommunityScannerApiKey(apiKey);
		scanner.status = ScannerStatus.PENDING;
		scanner.blacklistedUntil = new Date('2026-07-03T11:59:59.000Z');
		scannerRepositoryMock.findOne.mockResolvedValue(scanner);
		scannerRepositoryMock.save.mockImplementation(async (savedScanner) => {
			return savedScanner as CommunityScanner;
		});

		const result = await useCase.execute(validRequest);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap().status).toBe(ScannerStatus.ONLINE);
		expect(scannerRepositoryMock.save).toHaveBeenCalled();
	});

	it('should log and return persistence errors', async () => {
		const error = new Error('database unavailable');
		scannerRepositoryMock.findOne.mockRejectedValue(error);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
