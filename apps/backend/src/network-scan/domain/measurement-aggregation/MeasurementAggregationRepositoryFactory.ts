import { inject, injectable } from 'inversify';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { NodeMeasurementDayRepository } from '../node/NodeMeasurementDayRepository.js';
import type { OrganizationMeasurementDayRepository } from '../organization/OrganizationMeasurementDayRepository.js';
import type { NetworkMeasurementDayRepository } from '../network/NetworkMeasurementDayRepository.js';
import type { NetworkMeasurementMonthRepository } from '../network/NetworkMeasurementMonthRepository.js';
import { MeasurementAggregation } from './MeasurementAggregation.js';
import NodeMeasurementDay from '../node/NodeMeasurementDay.js';
import OrganizationMeasurementDay from '../organization/OrganizationMeasurementDay.js';
import NetworkMeasurementDay from '../network/NetworkMeasurementDay.js';
import NetworkMeasurementMonth from '../network/NetworkMeasurementMonth.js';
import type { MeasurementAggregationRepository } from './MeasurementAggregationRepository.js';

@injectable()
export class MeasurementAggregationRepositoryFactory {
	constructor(
		@inject(NETWORK_TYPES.NodeMeasurementDayRepository)
		private nodeMeasurementDayRepository: NodeMeasurementDayRepository,
		@inject(NETWORK_TYPES.OrganizationMeasurementDayRepository)
		private organizationMeasurementDayRepository: OrganizationMeasurementDayRepository,
		@inject(NETWORK_TYPES.NetworkMeasurementDayRepository)
		private networkMeasurementDayRepository: NetworkMeasurementDayRepository,
		@inject(NETWORK_TYPES.NetworkMeasurementMonthRepository)
		private networkMeasurementMonthRepository: NetworkMeasurementMonthRepository
	) {}

	createFor(
		aggregation: new (...params: never) => MeasurementAggregation
	): MeasurementAggregationRepository<MeasurementAggregation> {
		switch (aggregation) {
			case NodeMeasurementDay:
				return this.nodeMeasurementDayRepository;
			case OrganizationMeasurementDay:
				return this.organizationMeasurementDayRepository;
			case NetworkMeasurementDay:
				return this.networkMeasurementDayRepository;
			case NetworkMeasurementMonth:
				return this.networkMeasurementMonthRepository;
		}

		throw new Error(
			'unsupported MeasurementAggregation: ' + aggregation.toString()
		);
	}
}
