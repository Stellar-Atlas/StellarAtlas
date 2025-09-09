import { getConfigFromEnv } from '../Config';
import { err } from 'neverthrow';

describe('SMTP Configuration', () => {
	const originalEnv = process.env;

	beforeEach(() => {
		jest.resetModules();
		process.env = { ...originalEnv };
	});

	afterAll(() => {
		process.env = originalEnv;
	});

	describe('SMTP config parsing', () => {
		beforeEach(() => {
			// Set minimum required env vars
			process.env.IPSTACK_ACCESS_KEY = 'test-key';
			process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
			process.env.NETWORK_LEDGER_VERSION = '19';
			process.env.NETWORK_OVERLAY_VERSION = '25';
			process.env.NETWORK_OVERLAY_MIN_VERSION = '25';
			process.env.NETWORK_STELLAR_CORE_VERSION = '19.0.0';
			process.env.NETWORK_QUORUM_SET = '["GDMOXZXNN2UQJQJ47C3T6LLHZD366TJ3BKSGWM66F7MD5JXBP6DBRQXZ"]';
			process.env.NETWORK_ID = 'testnet';
			process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
			process.env.NETWORK_KNOWN_PEERS = '[["127.0.0.1", 11625]]';
		});

		it('should parse SMTP config when local SMTP is enabled', () => {
			process.env.ENABLE_LOCAL_SMTP = 'true';
			process.env.SMTP_HOST = 'smtp.gmail.com';
			process.env.SMTP_PORT = '587';
			process.env.SMTP_SECURE = 'true';
			process.env.SMTP_USERNAME = 'test@gmail.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.enableLocalSMTP).toBe(true);
			expect(config.smtpHost).toBe('smtp.gmail.com');
			expect(config.smtpPort).toBe(587);
			expect(config.smtpSecure).toBe(true);
			expect(config.smtpUsername).toBe('test@gmail.com');
			expect(config.smtpPassword).toBe('password');
			expect(config.smtpFromAddress).toBe('noreply@stellaratlas.io');
		});

		it('should default to disabled when ENABLE_LOCAL_SMTP is not set', () => {
			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.enableLocalSMTP).toBe(false);
		});

		it('should parse SMTP_SECURE as boolean', () => {
			process.env.ENABLE_LOCAL_SMTP = 'true';
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_PORT = '587';
			process.env.SMTP_SECURE = 'false';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.smtpSecure).toBe(false);
		});

		it('should parse SMTP_PORT as number', () => {
			process.env.ENABLE_LOCAL_SMTP = 'true';
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_PORT = '25';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.smtpPort).toBe(25);
			expect(typeof config.smtpPort).toBe('number');
		});

		it('should default SMTP_SECURE to false when not specified', () => {
			process.env.ENABLE_LOCAL_SMTP = 'true';
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_PORT = '587';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.smtpSecure).toBe(false);
		});

		it('should default SMTP_PORT to 587 when not specified', () => {
			process.env.ENABLE_LOCAL_SMTP = 'true';
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.smtpPort).toBe(587);
		});
	});

	describe('SMTP config validation', () => {
		beforeEach(() => {
			// Set minimum required env vars
			process.env.IPSTACK_ACCESS_KEY = 'test-key';
			process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
			process.env.NETWORK_LEDGER_VERSION = '19';
			process.env.NETWORK_OVERLAY_VERSION = '25';
			process.env.NETWORK_OVERLAY_MIN_VERSION = '25';
			process.env.NETWORK_STELLAR_CORE_VERSION = '19.0.0';
			process.env.NETWORK_QUORUM_SET = '["GDMOXZXNN2UQJQJ47C3T6LLHZD366TJ3BKSGWM66F7MD5JXBP6DBRQXZ"]';
			process.env.NETWORK_ID = 'testnet';
			process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
			process.env.NETWORK_KNOWN_PEERS = '[["127.0.0.1", 11625]]';
			process.env.ENABLE_LOCAL_SMTP = 'true';
		});

		it('should return error when SMTP_HOST is missing', () => {
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_HOST must be defined');
		});

		it('should return error when SMTP_USERNAME is missing', () => {
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_USERNAME must be defined');
		});

		it('should return error when SMTP_PASSWORD is missing', () => {
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_PASSWORD must be defined');
		});

		it('should return error when SMTP_FROM_ADDRESS is missing', () => {
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_FROM_ADDRESS must be defined');
		});

		it('should return error when SMTP_FROM_ADDRESS is invalid email', () => {
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'invalid-email';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_FROM_ADDRESS must be a valid email');
		});

		it('should return error when SMTP_PORT is not a valid number', () => {
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_PORT = 'not-a-number';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_PORT must be a valid number');
		});

		it('should return error when SMTP_PORT is out of valid range', () => {
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_PORT = '70000'; // Invalid port range
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP_PORT must be between 1 and 65535');
		});
	});

	describe('backward compatibility', () => {
		beforeEach(() => {
			// Set minimum required env vars
			process.env.IPSTACK_ACCESS_KEY = 'test-key';
			process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
			process.env.NETWORK_LEDGER_VERSION = '19';
			process.env.NETWORK_OVERLAY_VERSION = '25';
			process.env.NETWORK_OVERLAY_MIN_VERSION = '25';
			process.env.NETWORK_STELLAR_CORE_VERSION = '19.0.0';
			process.env.NETWORK_QUORUM_SET = '["GDMOXZXNN2UQJQJ47C3T6LLHZD366TJ3BKSGWM66F7MD5JXBP6DBRQXZ"]';
			process.env.NETWORK_ID = 'testnet';
			process.env.NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
			process.env.NETWORK_KNOWN_PEERS = '[["127.0.0.1", 11625]]';
		});

		it('should maintain existing user service config when SMTP is disabled', () => {
			process.env.NOTIFICATIONS_ENABLED = 'true';
			process.env.USER_SERVICE_BASE_URL = 'https://user-service.test';
			process.env.USER_SERVICE_USERNAME = 'user';
			process.env.USER_SERVICE_PASSWORD = 'password';
			process.env.FRONTEND_BASE_URL = 'https://frontend.test';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.enableNotifications).toBe(true);
			expect(config.userServiceBaseUrl).toBe('https://user-service.test');
			expect(config.enableLocalSMTP).toBe(false);
		});

		it('should allow both SMTP and external user service config to coexist', () => {
			process.env.ENABLE_LOCAL_SMTP = 'true';
			process.env.SMTP_HOST = 'smtp.test.com';
			process.env.SMTP_USERNAME = 'test@test.com';
			process.env.SMTP_PASSWORD = 'password';
			process.env.SMTP_FROM_ADDRESS = 'noreply@stellaratlas.io';
			process.env.NOTIFICATIONS_ENABLED = 'true';
			process.env.USER_SERVICE_BASE_URL = 'https://user-service.test';
			process.env.USER_SERVICE_USERNAME = 'user';
			process.env.USER_SERVICE_PASSWORD = 'password';
			process.env.FRONTEND_BASE_URL = 'https://frontend.test';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBeTruthy();
			const config = result._unsafeUnwrap();
			expect(config.enableLocalSMTP).toBe(true);
			expect(config.enableNotifications).toBe(true);
			expect(config.userServiceBaseUrl).toBe('https://user-service.test');
		});
	});
});