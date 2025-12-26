import { interfaces } from 'inversify';
import { DataSource, Repository } from 'typeorm';
import Container = interfaces.Container;

import { User } from '../database/entities/User';
import { LocalSMTPUserService, SMTPConfig } from '../../services/LocalSMTPUserService';
import { IUserService } from '../../domain/IUserService';
import { CORE_TYPES } from './di-types';
import validator from 'validator';

export function setupLocalSMTPContainer(
	container: Container,
	smtpConfig: SMTPConfig,
	fromAddress: string,
	enabled: boolean
): void {
	if (!enabled) {
		return;
	}

	// Validate configuration
	validateSMTPConfig(smtpConfig, fromAddress);

	// Bind User Repository
	container
		.bind<Repository<User>>(CORE_TYPES.UserRepository)
		.toDynamicValue(() => {
			const dataSource = container.get<DataSource>(DataSource);
			return dataSource.getRepository(User);
		})
		.inSingletonScope();

	// Bind SMTP Configuration
	container
		.bind<SMTPConfig>(CORE_TYPES.SMTPConfig)
		.toConstantValue(smtpConfig);

	// Bind From Address
	container
		.bind<string>(CORE_TYPES.SMTPFromAddress)
		.toConstantValue(fromAddress);

	// Bind LocalSMTPUserService to IUserService
	container
		.bind<IUserService>('UserService')
		.toDynamicValue(() => {
			const userRepository = container.get<Repository<User>>(CORE_TYPES.UserRepository);
			const config = container.get<SMTPConfig>(CORE_TYPES.SMTPConfig);
			const from = container.get<string>(CORE_TYPES.SMTPFromAddress);

			return new LocalSMTPUserService(userRepository, config, from);
		})
		.inSingletonScope();
}

function validateSMTPConfig(smtpConfig: SMTPConfig, fromAddress: string): void {
	if (!smtpConfig.host || smtpConfig.host.trim() === '') {
		throw new Error('SMTP host is required');
	}

	if (!smtpConfig.auth || !smtpConfig.auth.user || !smtpConfig.auth.pass) {
		throw new Error('SMTP authentication is required');
	}

	if (!validator.isEmail(fromAddress)) {
		throw new Error('Invalid from email address');
	}

	if (smtpConfig.port < 1 || smtpConfig.port > 65535) {
		throw new Error('SMTP port must be between 1 and 65535');
	}
}