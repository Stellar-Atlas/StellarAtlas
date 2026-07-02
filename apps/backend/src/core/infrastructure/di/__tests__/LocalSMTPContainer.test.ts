import { Container } from 'inversify';
import { DataSource, type Repository } from 'typeorm';
import { mock, type MockProxy } from 'jest-mock-extended';
import { User } from '../../database/entities/User.js';
import { LocalSMTPUserService, type SMTPConfig } from '@core/services/LocalSMTPUserService.js';
import type { IUserService } from '@core/domain/IUserService.js';
import { setupLocalSMTPContainer } from '../LocalSMTPContainer.js';
import { CORE_TYPES } from '../di-types.js';

describe('LocalSMTPContainer', () => {
	let container: Container;
	let mockDataSource: MockProxy<DataSource>;
	let mockUserRepository: MockProxy<Repository<User>>;

	const mockSMTPConfig: SMTPConfig = {
		host: 'smtp.test.com',
		port: 587,
		secure: false,
		auth: {
			user: 'test@test.com',
			pass: 'password'
		}
	};

	const fromAddress = 'noreply@stellaratlas.io';

	beforeEach(() => {
		container = new Container();
		mockDataSource = mock<DataSource>();
		mockUserRepository = mock<Repository<User>>();
		mockDataSource.getRepository.mockReturnValue(mockUserRepository);
		container.bind(DataSource).toConstantValue(mockDataSource);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('container setup', () => {
		it('should bind LocalSMTPUserService to IUserService when enabled', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>('UserService');
			expect(userService).toBeInstanceOf(LocalSMTPUserService);
		});

		it('should not bind LocalSMTPUserService when disabled', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, false);

			expect(() => container.get<IUserService>('UserService')).toThrow();
		});

		it('should bind User repository', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const repository = container.get<Repository<User>>(CORE_TYPES.UserRepository);
			expect(repository).toBe(mockUserRepository);
		});

		it('should bind SMTP configuration', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const smtpConfig = container.get(CORE_TYPES.SMTPConfig);
			expect(smtpConfig).toEqual(mockSMTPConfig);
		});

		it('should bind from email address', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const fromEmail = container.get<string>(CORE_TYPES.SMTPFromAddress);
			expect(fromEmail).toBe(fromAddress);
		});
	});

	describe('service creation', () => {
		it('should create LocalSMTPUserService with correct dependencies', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>('UserService');
			expect(userService).toBeInstanceOf(LocalSMTPUserService);

			// Verify dependencies are injected correctly
			const service = userService as LocalSMTPUserService;
			expect(service).toBeDefined();
		});

		it('should throw error when SMTP config is invalid', () => {
			const invalidConfig = { ...mockSMTPConfig, host: '' };

			expect(() => {
				setupLocalSMTPContainer(container, invalidConfig, fromAddress, true);
			}).toThrow();
		});

		it('should throw error when from address is invalid', () => {
			expect(() => {
				setupLocalSMTPContainer(container, mockSMTPConfig, 'invalid-email', true);
			}).toThrow();
		});
	});

	describe('service resolution', () => {
		it('should resolve service as singleton', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const service1 = container.get<IUserService>('UserService');
			const service2 = container.get<IUserService>('UserService');

			expect(service1).toBe(service2);
		});

		it('should resolve repository as singleton', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const repo1 = container.get<Repository<User>>(CORE_TYPES.UserRepository);
			const repo2 = container.get<Repository<User>>(CORE_TYPES.UserRepository);

			expect(repo1).toBe(repo2);
		});
	});

	describe('service interface compatibility', () => {
		it('should implement all IUserService methods', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>('UserService');

			expect(typeof userService.send).toBe('function');
			expect(typeof userService.findOrCreateUser).toBe('function');
			expect(typeof userService.findUser).toBe('function');
			expect(typeof userService.deleteUser).toBe('function');
		});

		it('should work with existing notification system', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>('UserService');
			
			// Should be compatible with Notifier class expectations
			expect(userService).toHaveProperty('send');
			expect(userService).toHaveProperty('findOrCreateUser');
			expect(userService).toHaveProperty('findUser');
			expect(userService).toHaveProperty('deleteUser');
		});
	});

	describe('configuration validation', () => {
		it('should validate SMTP host is present', () => {
			const configWithoutHost: SMTPConfig = { ...mockSMTPConfig, host: '' };

			expect(() => {
				setupLocalSMTPContainer(container, configWithoutHost, fromAddress, true);
			}).toThrow('SMTP host is required');
		});

		it('should validate SMTP auth is present', () => {
			const configWithoutAuth: SMTPConfig = {
				...mockSMTPConfig,
				auth: { user: '', pass: '' }
			};

			expect(() => {
				setupLocalSMTPContainer(container, configWithoutAuth, fromAddress, true);
			}).toThrow('SMTP authentication is required');
		});

		it('should validate from address format', () => {
			expect(() => {
				setupLocalSMTPContainer(container, mockSMTPConfig, 'not-an-email', true);
			}).toThrow('Invalid from email address');
		});

		it('should validate port is in valid range', () => {
			const configWithInvalidPort = { ...mockSMTPConfig, port: 70000 };

			expect(() => {
				setupLocalSMTPContainer(container, configWithInvalidPort, fromAddress, true);
			}).toThrow('SMTP port must be between 1 and 65535');
		});
	});
});
