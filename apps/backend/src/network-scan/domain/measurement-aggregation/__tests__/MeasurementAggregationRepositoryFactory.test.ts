import { MeasurementAggregationRepositoryFactory } from '../MeasurementAggregationRepositoryFactory.js';
import NodeMeasurementDay from '../../node/NodeMeasurementDay.js';
import { mock } from 'jest-mock-extended';
import type { NodeMeasurementDayRepository } from '../../node/NodeMeasurementDayRepository.js';
import type { OrganizationMeasurementDayRepository } from '../../organization/OrganizationMeasurementDayRepository.js';
import type { NetworkMeasurementDayRepository } from '../../network/NetworkMeasurementDayRepository.js';
import type { NetworkMeasurementMonthRepository } from '../../network/NetworkMeasurementMonthRepository.js';
import OrganizationMeasurementDay from '../../organization/OrganizationMeasurementDay.js';
import NetworkMeasurementDay from '../../network/NetworkMeasurementDay.js';
import NetworkMeasurementMonth from '../../network/NetworkMeasurementMonth.js';

it('should create correct repo', function () {
	const nodeMeasurementRepo = mock<NodeMeasurementDayRepository>();
	const organizationMeasurementRepo =
		mock<OrganizationMeasurementDayRepository>();
	const networkMeasurementDayRepo = mock<NetworkMeasurementDayRepository>();
	const networkMeasurementMonthRepo = mock<NetworkMeasurementMonthRepository>();
	const repositoryFactory = new MeasurementAggregationRepositoryFactory(
		nodeMeasurementRepo,
		organizationMeasurementRepo,
		networkMeasurementDayRepo,
		networkMeasurementMonthRepo
	);

	const nodeMeasurementDayResult =
		repositoryFactory.createFor(NodeMeasurementDay);
	expect(nodeMeasurementDayResult).toEqual(nodeMeasurementRepo);
	const organizationMeasurementDayResult = repositoryFactory.createFor(
		OrganizationMeasurementDay
	);
	expect(organizationMeasurementDayResult).toEqual(organizationMeasurementRepo);
	const networkMeasurementDayResult = repositoryFactory.createFor(
		NetworkMeasurementDay
	);
	expect(networkMeasurementDayResult).toEqual(networkMeasurementDayRepo);
	const networkMeasurementMonthResult = repositoryFactory.createFor(
		NetworkMeasurementMonth
	);
	expect(networkMeasurementMonthResult).toEqual(networkMeasurementMonthRepo);
});
