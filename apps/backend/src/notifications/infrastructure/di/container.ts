import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { TYPES } from './di-types.js';
import { NETWORK_TYPES as NETWORK_TYPES } from '../../../network-scan/infrastructure/di/di-types.js';
import type { MessageCreator } from '../../domain/notifier/MessageCreator.js';
import { EJSMessageCreator } from '../services/EJSMessageCreator.js';
import { EventDetector } from '../../domain/event/EventDetector.js';
import { NodeEventDetector } from '../../domain/event/NodeEventDetector.js';
import { NetworkEventDetector } from '../../domain/event/NetworkEventDetector.js';
import { Notifier } from '../../domain/notifier/Notifier.js';
import type { EventSourceService } from '../../domain/event/EventSourceService.js';
import { EventSourceFromNetworkService } from '../services/EventSourceFromNetworkService.js';
import { EventSourceIdFactory } from '../../domain/event/EventSourceIdFactory.js';
import type { IUserService } from '../../../core/domain/IUserService.js';
import { UserService } from '../../../core/services/UserService.js';
import { Notify } from '../../use-cases/determine-events-and-notify-subscribers/Notify.js';
import { UnmuteNotification } from '../../use-cases/unmute-notification/UnmuteNotification.js';
import { Subscribe } from '../../use-cases/subscribe/Subscribe.js';
import { Unsubscribe } from '../../use-cases/unsubscribe/Unsubscribe.js';
import { ConfirmSubscription } from '../../use-cases/confirm-subscription/ConfirmSubscription.js';
import { Config } from '../../../core/config/Config.js';
import type { EventRepository } from '../../domain/event/EventRepository.js';
import { TypeOrmEventRepository } from '../database/repositories/TypeOrmEventRepository.js';
import type { NodeMeasurementRepository } from '../../../network-scan/domain/node/NodeMeasurementRepository.js';
import type { OrganizationMeasurementRepository } from '../../../network-scan/domain/organization/OrganizationMeasurementRepository.js';
import { NetworkDTOService } from '../../../network-scan/services/NetworkDTOService.js';
import { DataSource } from 'typeorm';
import type { SubscriberRepository } from '../../domain/subscription/SubscriberRepository.js';
import { TypeOrmSubscriberRepository } from '../database/repositories/TypeOrmSubscriberRepository.js';
import { Subscriber } from '../../domain/subscription/Subscriber.js';
import { RequestUnsubscribeLink } from '../../use-cases/request-unsubscribe-link/RequestUnsubscribeLink.js';
import { setupLocalSMTPContainer } from '../../../core/infrastructure/di/LocalSMTPContainer.js';
import type { SMTPConfig } from '../../../core/services/LocalSMTPUserService.js';

export function load(container: Container, config: Config) {
	const dataSource = container.get(DataSource);
	container.bind(EventDetector).toSelf();
	container.bind(NodeEventDetector).toSelf();
	container.bind(NetworkEventDetector).toSelf();
	container.bind(Notifier).toSelf();
	container
		.bind<SubscriberRepository>('SubscriberRepository')
		.toDynamicValue(() => {
			return new TypeOrmSubscriberRepository(
				dataSource.getRepository(Subscriber)
			);
		})
		.inRequestScope();
	container
		.bind<EventSourceService>(TYPES.EventSourceService)
		.toDynamicValue(() => {
			return new EventSourceFromNetworkService(
				container.get(NetworkDTOService)
			);
		});
	container.bind(EventSourceIdFactory).toSelf();

	// Setup user service - use LocalSMTPUserService if enabled, otherwise use external UserService
	if (config.enableLocalSMTP) {
		// Setup LocalSMTPUserService via the container helper
		const smtpConfig: SMTPConfig = {
			host: config.smtpHost!,
			port: config.smtpPort || 587,
			secure: config.smtpSecure || false,
			auth: {
				user: config.smtpUsername!,
				pass: config.smtpPassword!
			}
		};

		setupLocalSMTPContainer(container, smtpConfig, config.smtpFromAddress!, true);
	} else {
		// Fallback to external user service
		container.bind<IUserService>('UserService').toDynamicValue(() => {
			if (!config.userServiceBaseUrl) {
				throw new Error('USER_SERVICE_BASE_URL not defined');
			}
			if (!config.userServiceUsername) {
				throw new Error('USER_SERVICE_USERNAME not defined');
			}
			if (!config.userServicePassword) {
				throw new Error('USER_SERVICE_PASSWORD not defined');
			}
			return new UserService(
				config.userServiceBaseUrl,
				config.userServiceUsername,
				config.userServicePassword,
				container.get('HttpService')
			);
		});
	}
	container.bind(Notify).toSelf();
	container.bind(UnmuteNotification).toSelf();
	container.bind(Subscribe).toSelf();
	container.bind(Unsubscribe).toSelf();
	container.bind(ConfirmSubscription).toSelf();
	container.bind(RequestUnsubscribeLink).toSelf();
	container
		.bind<MessageCreator>(TYPES.MessageCreator)
		.toDynamicValue(() => {
			if (!config.frontendBaseUrl) {
				throw new Error('FRONTEND_BASE_URL not defined');
			}
			return new EJSMessageCreator(
				config.frontendBaseUrl,
				container.get(TYPES.EventSourceService)
			);
		})
		.inRequestScope();
	container.bind<EventRepository>('EventRepository').toDynamicValue(() => {
		return new TypeOrmEventRepository(
			container.get<NodeMeasurementRepository>(
				NETWORK_TYPES.NodeMeasurementRepository
			),
			container.get<OrganizationMeasurementRepository>(
				NETWORK_TYPES.OrganizationMeasurementRepository
			)
		);
	});
}
