import { Result } from 'neverthrow';
import { UserId } from '../../notifications/domain/subscription/UserId.js';
import { CustomError } from '../errors/CustomError.js';
import { Message } from './Message.js';

export class CreateUserError extends CustomError {
	constructor(cause?: Error) {
		super('Could not create user', 'CreateUserError', cause);
	}
}

export interface IUserService {
	send(userId: UserId, message: Message): Promise<Result<void, Error>>;

	findOrCreateUser(emailAddress: string): Promise<Result<UserId, Error>>;

	findUser(emailAddress: string): Promise<Result<UserId | null, Error>>;

	deleteUser(userId: UserId): Promise<Result<void, Error>>;
}
