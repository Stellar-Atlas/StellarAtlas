import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import {
	CommunityScannerRegistrationRateLimitError,
	DuplicateCommunityScannerError,
	RegisterCommunityScanner
} from '../RegisterCommunityScanner.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../../infrastructure/database/entities/CommunityScanner.js';
import { Repository } from 'typeorm';
import { hashCommunityScannerApiKey } from '../../domain/CommunityScannerApiKey.js';
import type { CommunityScannerRegistrationThrottleRepository } from '../../domain/CommunityScannerRegistrationThrottle.js';
import { communityScannerRegistrationThrottlePolicy } from '../../domain/CommunityScannerRegistrationThrottle.js';

describe('RegisterCommunityScanner', () => {
	let useCase: RegisterCommunityScanner;
	let scannerRepositoryMock: MockProxy<Repository<CommunityScanner>>;
	let throttleRepositoryMock: MockProxy<CommunityScannerRegistrationThrottleRepository>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scannerRepositoryMock = mock<Repository<CommunityScanner>>();
		throttleRepositoryMock =
			mock<CommunityScannerRegistrationThrottleRepository>();
		throttleRepositoryMock.recordAttempt.mockResolvedValue({
			attemptCount: 1,
			windowStartedAt: new Date('2026-07-03T12:00:00.000Z')
		});
		throttleRepositoryMock.deleteStaleAttempts.mockResolvedValue(0);
		exceptionLoggerMock = mock<ExceptionLogger>();
		useCase = new RegisterCommunityScanner(
			scannerRepositoryMock,
			throttleRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	const validRequest = {
		name: ' Test Scanner ',
		description: ' A test community scanner ',
		contactEmail: ' TEST@EXAMPLE.COM ',
		registrationSource: '203.0.113.44'
	};

	it('should register a scanner with a hashed API key and one-time token', async () => {
		const scanner = new CommunityScanner();
		scanner.id = 'scanner-uuid';
		scanner.status = ScannerStatus.PENDING;
		scanner.createdAt = new Date('2026-07-03T12:00:00.000Z');
		scannerRepositoryMock.findOne.mockResolvedValue(null);
		scannerRepositoryMock.create.mockImplementation((data) =>
			Object.assign(scanner, data)
		);
		scannerRepositoryMock.save.mockResolvedValue(scanner);

		const result = await useCase.execute(validRequest);

		expect(result.isOk()).toBe(true);
		const dto = result._unsafeUnwrap();
		expect(dto).toMatchObject({
			id: 'scanner-uuid',
			name: 'Test Scanner',
			description: 'A test community scanner',
			status: ScannerStatus.PENDING,
			createdAt: '2026-07-03T12:00:00.000Z'
		});
		expect(dto.apiKey).toMatch(/^satlas_scanner_/);
		expect(scannerRepositoryMock.findOne).toHaveBeenCalledWith({
			where: { contactEmail: 'test@example.com' }
		});
		expect(throttleRepositoryMock.recordAttempt).toHaveBeenCalledWith(
			expect.stringMatching(/^[0-9a-f]{64}$/),
			new Date('2026-07-03T12:00:00.000Z'),
			60 * 60 * 1000
		);
		expect(throttleRepositoryMock.recordAttempt.mock.calls[0]?.[0]).not.toContain(
			'203.0.113.44'
		);
		expect(throttleRepositoryMock.deleteStaleAttempts).toHaveBeenCalledWith(
			new Date('2026-06-26T12:00:00.000Z'),
			communityScannerRegistrationThrottlePolicy.cleanupBatchSize
		);
		expect(scannerRepositoryMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Test Scanner',
				description: 'A test community scanner',
				contactEmail: 'test@example.com',
				status: ScannerStatus.PENDING
			})
		);
		expect(scanner.apiKeyHash).toBe(hashCommunityScannerApiKey(dto.apiKey));
		expect(scanner.apiKeyHash).not.toBe(dto.apiKey);
	});

	it('should reject duplicate contact emails without creating a scanner', async () => {
		scannerRepositoryMock.findOne.mockResolvedValue(new CommunityScanner());

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(
			DuplicateCommunityScannerError
		);
		expect(scannerRepositoryMock.create).not.toHaveBeenCalled();
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should log stale throttle cleanup errors without rejecting registration', async () => {
		const cleanupError = new Error('cleanup failed');
		const scanner = new CommunityScanner();
		scanner.id = 'scanner-uuid';
		scanner.status = ScannerStatus.PENDING;
		scanner.createdAt = new Date('2026-07-03T12:00:00.000Z');
		throttleRepositoryMock.deleteStaleAttempts.mockRejectedValue(cleanupError);
		scannerRepositoryMock.findOne.mockResolvedValue(null);
		scannerRepositoryMock.create.mockImplementation((data) =>
			Object.assign(scanner, data)
		);
		scannerRepositoryMock.save.mockResolvedValue(scanner);

		const result = await useCase.execute(validRequest);

		expect(result.isOk()).toBe(true);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(
			cleanupError
		);
		expect(scannerRepositoryMock.save).toHaveBeenCalledWith(scanner);
	});

	it('should rate-limit scanner registrations before lookup work', async () => {
		throttleRepositoryMock.recordAttempt.mockResolvedValue({
			attemptCount: 6,
			windowStartedAt: new Date('2026-07-03T11:30:00.000Z')
		});

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		const error = result._unsafeUnwrapErr();
		expect(error).toBeInstanceOf(CommunityScannerRegistrationRateLimitError);
		expect(
			(error as CommunityScannerRegistrationRateLimitError).retryAfterSeconds
		).toBe(1800);
		expect(scannerRepositoryMock.findOne).not.toHaveBeenCalled();
		expect(scannerRepositoryMock.create).not.toHaveBeenCalled();
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
		expect(throttleRepositoryMock.deleteStaleAttempts).not.toHaveBeenCalled();
	});

	it('should log throttle persistence errors without registering', async () => {
		const error = new Error('throttle store unavailable');
		throttleRepositoryMock.recordAttempt.mockRejectedValue(error);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
		expect(scannerRepositoryMock.findOne).not.toHaveBeenCalled();
		expect(scannerRepositoryMock.create).not.toHaveBeenCalled();
		expect(scannerRepositoryMock.save).not.toHaveBeenCalled();
	});

	it('should map database unique races to duplicate scanner errors', async () => {
		const scanner = new CommunityScanner();
		const duplicateError = Object.assign(new Error('duplicate key value'), {
			code: '23505',
			constraint: 'idx_community_scanners_contact_email_unique'
		});
		scannerRepositoryMock.findOne.mockResolvedValue(null);
		scannerRepositoryMock.create.mockReturnValue(scanner);
		scannerRepositoryMock.save.mockRejectedValue(duplicateError);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBeInstanceOf(
			DuplicateCommunityScannerError
		);
		expect(exceptionLoggerMock.captureException).not.toHaveBeenCalled();
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
