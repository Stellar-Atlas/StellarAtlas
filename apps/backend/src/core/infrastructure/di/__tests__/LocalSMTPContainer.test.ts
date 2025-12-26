import { Container } from 'inversify';
import { Repository } from 'typeorm';
import { User } from '../../database/entities/User';
import { LocalSMTPUserService } from '../../../services/LocalSMTPUserService';
import { IUserService } from '../../../domain/IUserService';
import { setupLocalSMTPContainer } from '../LocalSMTPContainer';
import { TYPES } from '../di-types';

jest.mock('typeorm', () => ({
	...jest.requireActual('typeorm'),
	getRepository: jest.fn()
}));

describe('LocalSMTPContainer', () => {
	let container: Container;
	let mockUserRepository: jest.Mocked<Repository<User>>;

	const mockSMTPConfig = {
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
		mockUserRepository = {
			findOne: jest.fn(),
			save: jest.fn(),
			remove: jest.fn(),
			create: jest.fn(),
			find: jest.fn(),
			manager: {
				query: jest.fn()
			}
		} as any;

		// Mock TypeORM repository
		(require('typeorm').getRepository as jest.Mock).mockReturnValue(mockUserRepository);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('container setup', () => {
		it('should bind LocalSMTPUserService to IUserService when enabled', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>(TYPES.UserService);
			expect(userService).toBeInstanceOf(LocalSMTPUserService);
		});

		it('should not bind LocalSMTPUserService when disabled', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, false);

			expect(() => container.get<IUserService>(TYPES.UserService)).toThrow();
		});

		it('should bind User repository', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const repository = container.get<Repository<User>>(TYPES.UserRepository);
			expect(repository).toBe(mockUserRepository);
		});

		it('should bind SMTP configuration', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const smtpConfig = container.get(TYPES.SMTPConfig);
			expect(smtpConfig).toEqual(mockSMTPConfig);
		});

		it('should bind from email address', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const fromEmail = container.get<string>(TYPES.SMTPFromAddress);
			expect(fromEmail).toBe(fromAddress);
		});
	});

	describe('service creation', () => {
		it('should create LocalSMTPUserService with correct dependencies', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>(TYPES.UserService);
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

			const service1 = container.get<IUserService>(TYPES.UserService);
			const service2 = container.get<IUserService>(TYPES.UserService);

			expect(service1).toBe(service2);
		});

		it('should resolve repository as singleton', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const repo1 = container.get<Repository<User>>(TYPES.UserRepository);
			const repo2 = container.get<Repository<User>>(TYPES.UserRepository);

			expect(repo1).toBe(repo2);
		});
	});

	describe('service interface compatibility', () => {
		it('should implement all IUserService methods', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>(TYPES.UserService);

			expect(typeof userService.send).toBe('function');
			expect(typeof userService.findOrCreateUser).toBe('function');
			expect(typeof userService.findUser).toBe('function');
			expect(typeof userService.deleteUser).toBe('function');
		});

		it('should work with existing notification system', () => {
			setupLocalSMTPContainer(container, mockSMTPConfig, fromAddress, true);

			const userService = container.get<IUserService>(TYPES.UserService);
			
			// Should be compatible with Notifier class expectations
			expect(userService).toHaveProperty('send');
			expect(userService).toHaveProperty('findOrCreateUser');
			expect(userService).toHaveProperty('findUser');
			expect(userService).toHaveProperty('deleteUser');
		});
	});

	describe('configuration validation', () => {
		it('should validate SMTP host is present', () => {
			const configWithoutHost = { ...mockSMTPConfig, host: undefined as any };

			expect(() => {
				setupLocalSMTPContainer(container, configWithoutHost, fromAddress, true);
			}).toThrow('SMTP host is required');
		});

		it('should validate SMTP auth is present', () => {
			const configWithoutAuth = { ...mockSMTPConfig, auth: undefined as any };

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