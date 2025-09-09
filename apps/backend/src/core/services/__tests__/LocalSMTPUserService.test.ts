import { LocalSMTPUserService } from '../LocalSMTPUserService';
import { UserId } from '../../../notifications/domain/subscription/UserId';
import { Message } from '../../domain/Message';
import { randomUUID } from 'crypto';
import { mock } from 'jest-mock-extended';
import { Repository } from 'typeorm';
import { User } from '../../infrastructure/database/entities/User';
import * as nodemailer from 'nodemailer';
import { ok, err } from 'neverthrow';

// Mock nodemailer
jest.mock('nodemailer');
const mockNodemailer = nodemailer as jest.Mocked<typeof nodemailer>;

const mockUserRepository = mock<Repository<User>>();
const mockTransporter = {
	sendMail: jest.fn(),
	verify: jest.fn()
};

mockNodemailer.createTransport.mockReturnValue(mockTransporter as any);

const smtpConfig = {
	host: 'smtp.test.com',
	port: 587,
	secure: false,
	auth: {
		user: 'test@test.com',
		pass: 'password'
	}
};

const fromAddress = 'noreply@stellaratlas.io';

describe('LocalSMTPUserService', () => {
	let userService: LocalSMTPUserService;

	beforeEach(() => {
		jest.clearAllMocks();
		userService = new LocalSMTPUserService(
			mockUserRepository,
			smtpConfig,
			fromAddress
		);
	});

	describe('constructor', () => {
		it('should create transporter with correct SMTP config', () => {
			expect(mockNodemailer.createTransporter).toHaveBeenCalledWith(smtpConfig);
		});

		it('should throw error when from address is invalid', () => {
			expect(() => new LocalSMTPUserService(
				mockUserRepository,
				smtpConfig,
				'invalid-email'
			)).toThrowError('Invalid from email address');
		});

		it('should throw error when SMTP host is missing', () => {
			expect(() => new LocalSMTPUserService(
				mockUserRepository,
				{ ...smtpConfig, host: '' },
				fromAddress
			)).toThrowError('SMTP host is required');
		});
	});

	describe('send', () => {
		const userId = UserId.create(randomUUID());
		const message = new Message('Test body', 'Test subject');

		beforeEach(() => {
			if (userId.isErr()) throw userId.error;
		});

		it('should send email successfully', async () => {
			const mockUser = {
				id: userId._unsafeUnwrap().value,
				email: 'test@example.com',
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockTransporter.sendMail.mockResolvedValue({
				messageId: 'test-message-id',
				response: '250 Message accepted'
			});

			const result = await userService.send(userId._unsafeUnwrap(), message);

			expect(result.isOk()).toBeTruthy();
			expect(mockUserRepository.findOne).toHaveBeenCalledWith({
				where: { id: userId._unsafeUnwrap().value }
			});
			expect(mockTransporter.sendMail).toHaveBeenCalledWith({
				from: fromAddress,
				to: mockUser.email,
				subject: message.title,
				html: message.body
			});
		});

		it('should return error when user not found', async () => {
			mockUserRepository.findOne.mockResolvedValue(null);

			const result = await userService.send(userId._unsafeUnwrap(), message);

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('User not found');
		});

		it('should return error when email sending fails', async () => {
			const mockUser = {
				id: userId._unsafeUnwrap().value,
				email: 'test@example.com',
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockTransporter.sendMail.mockRejectedValue(new Error('SMTP error'));

			const result = await userService.send(userId._unsafeUnwrap(), message);

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Failed to send email');
		});

		it('should return error when database query fails', async () => {
			mockUserRepository.findOne.mockRejectedValue(new Error('Database error'));

			const result = await userService.send(userId._unsafeUnwrap(), message);

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Database error');
		});
	});

	describe('findOrCreateUser', () => {
		const email = 'test@example.com';

		it('should return existing user if found', async () => {
			const existingUserId = randomUUID();
			const mockUser = {
				id: existingUserId,
				email: email,
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(mockUser);

			const result = await userService.findOrCreateUser(email);

			expect(result.isOk()).toBeTruthy();
			expect(result._unsafeUnwrap().value).toBe(existingUserId);
			expect(mockUserRepository.findOne).toHaveBeenCalledWith({
				where: { email }
			});
			expect(mockUserRepository.save).not.toHaveBeenCalled();
		});

		it('should create new user if not found', async () => {
			const newUserId = randomUUID();
			const newUser = {
				id: newUserId,
				email: email,
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(null);
			mockUserRepository.save.mockResolvedValue(newUser);

			const result = await userService.findOrCreateUser(email);

			expect(result.isOk()).toBeTruthy();
			expect(result._unsafeUnwrap().value).toBe(newUserId);
			expect(mockUserRepository.save).toHaveBeenCalledWith({
				email,
				id: expect.any(String)
			});
		});

		it('should return error for invalid email format', async () => {
			const result = await userService.findOrCreateUser('invalid-email');

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Invalid email address');
		});

		it('should return error when database save fails', async () => {
			mockUserRepository.findOne.mockResolvedValue(null);
			mockUserRepository.save.mockRejectedValue(new Error('Database error'));

			const result = await userService.findOrCreateUser(email);

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Failed to create user');
		});

		it('should return error when database find fails', async () => {
			mockUserRepository.findOne.mockRejectedValue(new Error('Database error'));

			const result = await userService.findOrCreateUser(email);

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Database error');
		});
	});

	describe('findUser', () => {
		const email = 'test@example.com';

		it('should return user id when user exists', async () => {
			const existingUserId = randomUUID();
			const mockUser = {
				id: existingUserId,
				email: email,
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(mockUser);

			const result = await userService.findUser(email);

			expect(result.isOk()).toBeTruthy();
			expect(result._unsafeUnwrap()?.value).toBe(existingUserId);
		});

		it('should return null when user does not exist', async () => {
			mockUserRepository.findOne.mockResolvedValue(null);

			const result = await userService.findUser(email);

			expect(result.isOk()).toBeTruthy();
			expect(result._unsafeUnwrap()).toBeNull();
		});

		it('should return error for invalid email format', async () => {
			const result = await userService.findUser('invalid-email');

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Invalid email address');
		});

		it('should return error when database query fails', async () => {
			mockUserRepository.findOne.mockRejectedValue(new Error('Database error'));

			const result = await userService.findUser(email);

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Database error');
		});
	});

	describe('deleteUser', () => {
		const userId = UserId.create(randomUUID());

		beforeEach(() => {
			if (userId.isErr()) throw userId.error;
		});

		it('should delete user successfully', async () => {
			const mockUser = {
				id: userId._unsafeUnwrap().value,
				email: 'test@example.com',
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockUserRepository.remove.mockResolvedValue(mockUser);

			const result = await userService.deleteUser(userId._unsafeUnwrap());

			expect(result.isOk()).toBeTruthy();
			expect(mockUserRepository.findOne).toHaveBeenCalledWith({
				where: { id: userId._unsafeUnwrap().value }
			});
			expect(mockUserRepository.remove).toHaveBeenCalledWith(mockUser);
		});

		it('should return error when user not found', async () => {
			mockUserRepository.findOne.mockResolvedValue(null);

			const result = await userService.deleteUser(userId._unsafeUnwrap());

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('User not found');
		});

		it('should return error when database delete fails', async () => {
			const mockUser = {
				id: userId._unsafeUnwrap().value,
				email: 'test@example.com',
				createdAt: new Date(),
				updatedAt: new Date()
			};

			mockUserRepository.findOne.mockResolvedValue(mockUser);
			mockUserRepository.remove.mockRejectedValue(new Error('Database error'));

			const result = await userService.deleteUser(userId._unsafeUnwrap());

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('Failed to delete user');
		});
	});

	describe('verifyConnection', () => {
		it('should return success when SMTP connection is valid', async () => {
			mockTransporter.verify.mockResolvedValue(true);

			const result = await userService.verifyConnection();

			expect(result.isOk()).toBeTruthy();
			expect(mockTransporter.verify).toHaveBeenCalled();
		});

		it('should return error when SMTP connection fails', async () => {
			mockTransporter.verify.mockRejectedValue(new Error('Connection failed'));

			const result = await userService.verifyConnection();

			expect(result.isErr()).toBeTruthy();
			expect(result._unsafeUnwrapErr().message).toContain('SMTP connection failed');
		});
	});
});