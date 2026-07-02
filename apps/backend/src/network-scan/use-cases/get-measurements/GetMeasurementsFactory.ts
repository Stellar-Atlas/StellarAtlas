import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { GetMeasurements } from './GetMeasurements.js';
import { Measurement } from '../../domain/measurement/Measurement.js';
import NodeMeasurement from '../../domain/node/NodeMeasurement.js';
import OrganizationMeasurement from '../../domain/organization/OrganizationMeasurement.js';
import NetworkMeasurement from '../../domain/network/NetworkMeasurement.js';
import type { NodeMeasurementRepository } from '../../domain/node/NodeMeasurementRepository.js';
import type { NetworkMeasurementRepository } from '../../domain/network/NetworkMeasurementRepository.js';
import type { OrganizationMeasurementRepository } from '../../domain/organization/OrganizationMeasurementRepository.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';

//todo: should be MeasurementRepositoryFactory, not GetMeasurementsFactory, and should be moved to domain
@injectable()
export class GetMeasurementsFactory {
	constructor(
		@inject(NETWORK_TYPES.NodeMeasurementRepository)
		private nodeMeasurementRepository: NodeMeasurementRepository,
		@inject(NETWORK_TYPES.NetworkMeasurementRepository)
		private networkMeasurementRepository: NetworkMeasurementRepository,
		@inject(NETWORK_TYPES.OrganizationMeasurementRepository)
		private organizationMeasurementsRepository: OrganizationMeasurementRepository,
		@inject('ExceptionLogger') private exceptionLogger: ExceptionLogger
	) {}

	createFor(
		measurement: new (...params: never) => Measurement
	): GetMeasurements {
		//todo: type safety with record
		switch (measurement) {
			case NodeMeasurement:
				return new GetMeasurements(
					this.nodeMeasurementRepository,
					this.exceptionLogger
				);
			case OrganizationMeasurement:
				return new GetMeasurements(
					this.organizationMeasurementsRepository,
					this.exceptionLogger
				);
			case NetworkMeasurement:
				return new GetMeasurements(
					this.networkMeasurementRepository,
					this.exceptionLogger
				);
		}

		throw new Error('Invalid class parameter');
	}
}
