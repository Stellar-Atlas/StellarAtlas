import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { GetMeasurements } from '../GetMeasurements.js';
import type { NodeMeasurementRepository } from '@network-scan/domain/node/NodeMeasurementRepository.js';

it('should capture and return errors', async function () {
	const service = mock<NodeMeasurementRepository>();
	service.findBetween.mockRejectedValue(new Error('test'));
	const exceptionLogger = mock<ExceptionLogger>();
	const getNetworkStatistics = new GetMeasurements(service, exceptionLogger);
	const result = await getNetworkStatistics.execute({
		id: 'a',
		from: new Date(),
		to: new Date()
	});
	expect(result.isErr()).toBe(true);
	expect(exceptionLogger.captureException).toHaveBeenCalledTimes(1);
});

it('should return measurements', async function () {
	const service = mock<NodeMeasurementRepository>();
	service.findBetween.mockResolvedValue([]);
	const exceptionLogger = mock<ExceptionLogger>();
	const getNetworkStatistics = new GetMeasurements(service, exceptionLogger);
	const result = await getNetworkStatistics.execute({
		id: 'a',
		from: new Date(),
		to: new Date()
	});
	expect(result.isOk()).toBe(true);
	if (result.isErr()) return;
	expect(result.value).toEqual([]);
});
