import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { MeasurementAggregationRepositoryFactory } from '@network-scan/domain/measurement-aggregation/MeasurementAggregationRepositoryFactory.js';
import { GetMeasurementAggregations } from '../GetMeasurementAggregations.js';
import {
	AggregationTarget,
	GetMeasurementAggregationsDTO
} from '../GetMeasurementAggregationsDTO.js';
import NodeMeasurementDay from '@network-scan/domain/node/NodeMeasurementDay.js';
import NetworkMeasurementDay from '@network-scan/domain/network/NetworkMeasurementDay.js';
import OrganizationMeasurementDay from '@network-scan/domain/organization/OrganizationMeasurementDay.js';
import NetworkMeasurementMonth from '@network-scan/domain/network/NetworkMeasurementMonth.js';
import type { MeasurementAggregationRepository } from '@network-scan/domain/measurement-aggregation/MeasurementAggregationRepository.js';
import { MeasurementAggregation } from '@network-scan/domain/measurement-aggregation/MeasurementAggregation.js';

it('should call the right repo', function () {
	const factory = mock<MeasurementAggregationRepositoryFactory>();
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetMeasurementAggregations(factory, exceptionLogger);
	const dto: GetMeasurementAggregationsDTO = {
		id: 'id',
		aggregationTarget: AggregationTarget.NodeDay,
		from: new Date(),
		to: new Date()
	};
	useCase.execute(dto);
	expect(factory.createFor).toHaveBeenCalledTimes(1);
	expect(factory.createFor).toHaveBeenCalledWith(NodeMeasurementDay);

	factory.createFor.mockClear();
	dto.aggregationTarget = AggregationTarget.NetworkDay;
	useCase.execute(dto);
	expect(factory.createFor).toHaveBeenCalledTimes(1);
	expect(factory.createFor).toHaveBeenCalledWith(NetworkMeasurementDay);

	factory.createFor.mockClear();
	dto.aggregationTarget = AggregationTarget.OrganizationDay;
	useCase.execute(dto);
	expect(factory.createFor).toHaveBeenCalledTimes(1);
	expect(factory.createFor).toHaveBeenCalledWith(OrganizationMeasurementDay);

	factory.createFor.mockClear();
	dto.aggregationTarget = AggregationTarget.NetworkMonth;
	useCase.execute(dto);
	expect(factory.createFor).toHaveBeenCalledTimes(1);
	expect(factory.createFor).toHaveBeenCalledWith(NetworkMeasurementMonth);
});

it('should capture and return errors', async function () {
	const repo = mock<MeasurementAggregationRepository<MeasurementAggregation>>();
	const factory = mock<MeasurementAggregationRepositoryFactory>();
	repo.findBetween.mockReturnValue(Promise.reject(new Error('test')));
	factory.createFor.mockReturnValue(repo);
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetMeasurementAggregations(factory, exceptionLogger);
	const result = await useCase.execute({
		id: 'id',
		aggregationTarget: AggregationTarget.NetworkMonth,
		from: new Date(),
		to: new Date()
	});
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});

it('should return measurement aggregations', async function () {
	const repo = mock<MeasurementAggregationRepository<MeasurementAggregation>>();
	const factory = mock<MeasurementAggregationRepositoryFactory>();
	repo.findBetween.mockReturnValue(Promise.resolve([]));
	factory.createFor.mockReturnValue(repo);
	const exceptionLogger = mock<ExceptionLogger>();
	const useCase = new GetMeasurementAggregations(factory, exceptionLogger);
	const result = await useCase.execute({
		id: 'id',
		aggregationTarget: AggregationTarget.NetworkMonth,
		from: new Date(),
		to: new Date()
	});
	expect(result.isOk()).toBe(true);
	if (!result.isOk()) throw result.error;
	expect(result.value).toEqual([]);
});

it('should map to correct return DTO', function () {
	//todo
});
