import { mock, MockProxy } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import {
	DuplicateCommunityScannerError,
	RegisterCommunityScanner
} from '../RegisterCommunityScanner.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../../infrastructure/database/entities/CommunityScanner.js';
import { Repository } from 'typeorm';
import { hashCommunityScannerApiKey } from '../../domain/CommunityScannerApiKey.js';

describe('RegisterCommunityScanner', () => {
	let useCase: RegisterCommunityScanner;
	let scannerRepositoryMock: MockProxy<Repository<CommunityScanner>>;
	let exceptionLoggerMock: MockProxy<ExceptionLogger>;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-03T12:00:00.000Z'));
		scannerRepositoryMock = mock<Repository<CommunityScanner>>();
		exceptionLoggerMock = mock<ExceptionLogger>();
		useCase = new RegisterCommunityScanner(
			scannerRepositoryMock,
			exceptionLoggerMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	const validRequest = {
		name: ' Test Scanner ',
		description: ' A test community scanner ',
		contactEmail: ' TEST@EXAMPLE.COM '
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

	it('should log and return persistence errors', async () => {
		const error = new Error('database unavailable');
		scannerRepositoryMock.findOne.mockRejectedValue(error);

		const result = await useCase.execute(validRequest);

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
		expect(exceptionLoggerMock.captureException).toHaveBeenCalledWith(error);
	});
});
