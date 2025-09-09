import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { Result, ok, err } from 'neverthrow';
import * as nodemailer from 'nodemailer';
import validator from 'validator';
import { randomUUID } from 'crypto';

import { IUserService } from '../domain/IUserService';
import { UserId } from '../../notifications/domain/subscription/UserId';
import { Message } from '../domain/Message';
import { User } from '../infrastructure/database/entities/User';
import { CustomError } from '../errors/CustomError';

export interface SMTPConfig {
	host: string;
	port: number;
	secure: boolean;
	auth: {
		user: string;
		pass: string;
	};
}

export class LocalSMTPUserServiceError extends CustomError {
	constructor(message: string, name: string, cause?: Error) {
		super(message, name, cause);
	}
}

export class UserNotFoundError extends LocalSMTPUserServiceError {
	constructor(userId: string, cause?: Error) {
		super(`User not found: ${userId}`, 'UserNotFoundError', cause);
	}
}

export class EmailSendError extends LocalSMTPUserServiceError {
	constructor(message: string, cause?: Error) {
		super(`Failed to send email: ${message}`, 'EmailSendError', cause);
	}
}

export class UserCreationError extends LocalSMTPUserServiceError {
	constructor(message: string, cause?: Error) {
		super(`Failed to create user: ${message}`, 'UserCreationError', cause);
	}
}

export class DatabaseError extends LocalSMTPUserServiceError {
	constructor(message: string, cause?: Error) {
		super(`Database error: ${message}`, 'DatabaseError', cause);
	}
}

export class SMTPConnectionError extends LocalSMTPUserServiceError {
	constructor(message: string, cause?: Error) {
		super(`SMTP connection failed: ${message}`, 'SMTPConnectionError', cause);
	}
}

@injectable()
export class LocalSMTPUserService implements IUserService {
	private transporter: nodemailer.Transporter;

	constructor(
		private userRepository: Repository<User>,
		private smtpConfig: SMTPConfig,
		private fromAddress: string
	) {
		this.validateConfig();
		this.transporter = nodemailer.createTransport(this.smtpConfig);
	}

	private validateConfig(): void {
		if (!this.smtpConfig.host || this.smtpConfig.host.trim() === '') {
			throw new Error('SMTP host is required');
		}

		if (!this.smtpConfig.auth || !this.smtpConfig.auth.user || !this.smtpConfig.auth.pass) {
			throw new Error('SMTP authentication is required');
		}

		if (!validator.isEmail(this.fromAddress)) {
			throw new Error('Invalid from email address');
		}

		if (this.smtpConfig.port < 1 || this.smtpConfig.port > 65535) {
			throw new Error('SMTP port must be between 1 and 65535');
		}
	}

	async send(userId: UserId, message: Message): Promise<Result<void, Error>> {
		try {
			// Find user by ID
			const user = await this.userRepository.findOne({
				where: { id: userId.value }
			});

			if (!user) {
				return err(new UserNotFoundError(userId.value));
			}

			// Send email
			const mailOptions = {
				from: this.fromAddress,
				to: user.email,
				subject: message.title,
				html: message.body
			};

			await this.transporter.sendMail(mailOptions);

			return ok(undefined);
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return err(new UserNotFoundError(userId.value, error));
				}
				if (error.message.includes('SMTP') || error.message.includes('mail')) {
					return err(new EmailSendError(error.message, error));
				}
				return err(new DatabaseError(error.message, error));
			}
			return err(new LocalSMTPUserServiceError('Unknown error occurred', 'UnknownError'));
		}
	}

	async findOrCreateUser(emailAddress: string): Promise<Result<UserId, Error>> {
		try {
			if (!validator.isEmail(emailAddress)) {
				return err(new Error('Invalid email address'));
			}

			const normalizedEmail = emailAddress.trim().toLowerCase();

			// Try to find existing user
			let user = await this.userRepository.findOne({
				where: { email: normalizedEmail }
			});

			if (user) {
				const userIdResult = UserId.create(user.id);
				if (userIdResult.isErr()) {
					return err(userIdResult.error);
				}
				return ok(userIdResult.value);
			}

			// Create new user
			const newUserId = randomUUID();
			user = this.userRepository.create({
				id: newUserId,
				email: normalizedEmail
			});

			await this.userRepository.save(user);

			const userIdResult = UserId.create(newUserId);
			if (userIdResult.isErr()) {
				return err(userIdResult.error);
			}

			return ok(userIdResult.value);
		} catch (error) {
			if (error instanceof Error) {
				return err(new UserCreationError(error.message, error));
			}
			return err(new UserCreationError('Unknown error occurred during user creation'));
		}
	}

	async findUser(emailAddress: string): Promise<Result<UserId | null, Error>> {
		try {
			if (!validator.isEmail(emailAddress)) {
				return err(new Error('Invalid email address'));
			}

			const normalizedEmail = emailAddress.trim().toLowerCase();

			const user = await this.userRepository.findOne({
				where: { email: normalizedEmail }
			});

			if (!user) {
				return ok(null);
			}

			const userIdResult = UserId.create(user.id);
			if (userIdResult.isErr()) {
				return err(userIdResult.error);
			}

			return ok(userIdResult.value);
		} catch (error) {
			if (error instanceof Error) {
				return err(new DatabaseError(error.message, error));
			}
			return err(new DatabaseError('Unknown error occurred during user search'));
		}
	}

	async deleteUser(userId: UserId): Promise<Result<void, Error>> {
		try {
			const user = await this.userRepository.findOne({
				where: { id: userId.value }
			});

			if (!user) {
				return err(new UserNotFoundError(userId.value));
			}

			await this.userRepository.remove(user);

			return ok(undefined);
		} catch (error) {
			if (error instanceof Error) {
				if (error.message.includes('not found')) {
					return err(new UserNotFoundError(userId.value, error));
				}
				return err(new LocalSMTPUserServiceError('Failed to delete user', 'UserDeletionError', error));
			}
			return err(new LocalSMTPUserServiceError('Unknown error occurred during user deletion', 'UnknownError'));
		}
	}

	async verifyConnection(): Promise<Result<void, Error>> {
		try {
			await this.transporter.verify();
			return ok(undefined);
		} catch (error) {
			if (error instanceof Error) {
				return err(new SMTPConnectionError(error.message, error));
			}
			return err(new SMTPConnectionError('Unknown SMTP connection error'));
		}
	}
}