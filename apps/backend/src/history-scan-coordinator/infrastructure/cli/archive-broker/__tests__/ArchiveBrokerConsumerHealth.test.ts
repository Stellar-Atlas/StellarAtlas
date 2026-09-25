import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import {
	createArchiveBrokerConsumerStateReporter,
	readArchiveBrokerOccupancy
} from '../ArchiveBrokerConsumerHealth.js';

const consumer = {
	num_ack_pending: 211,
	num_pending: 0,
	delivered: { stream_seq: 74_157_583 }
};
const stream = { state: { messages: 105, last_seq: 74_156_560 } };

describe('archive broker consumer consistency', () => {
	it('detects the persisted future consumer position from the stalled runtime', async () => {
		const readStream = jest.fn().mockResolvedValue(stream);
		const result = await readArchiveBrokerOccupancy(
			async () => consumer,
			readStream
		);
		expect(result.inconsistent).toBe(true);
		expect(result.consumer.num_ack_pending).toBe(211);
		expect(readStream).toHaveBeenCalledTimes(2);
	});

	it('does not misclassify concurrent new publication as corruption', async () => {
		const readStream = jest
			.fn()
			.mockResolvedValueOnce(stream)
			.mockResolvedValueOnce({
				state: { messages: 120, last_seq: 74_157_583 }
			});
		expect(
			(await readArchiveBrokerOccupancy(async () => consumer, readStream))
				.inconsistent
		).toBe(false);
	});

	it('keeps healthy metadata reads at two and does not infer corruption from occupancy alone', async () => {
		const readConsumer = jest.fn().mockResolvedValue({
			...consumer,
			delivered: { stream_seq: 74_156_560 }
		});
		const readStream = jest.fn().mockResolvedValue(stream);
		expect(
			(await readArchiveBrokerOccupancy(readConsumer, readStream)).inconsistent
		).toBe(false);
		expect(readConsumer).toHaveBeenCalledTimes(1);
		expect(readStream).toHaveBeenCalledTimes(1);
	});

	it('propagates metadata errors rather than inventing available capacity', async () => {
		await expect(
			readArchiveBrokerOccupancy(
				async () => {
					throw new Error('broker unavailable');
				},
				async () => stream
			)
		).rejects.toThrow('broker unavailable');
	});

	it('reports immediately, throttles repeated errors, and reports recovery', () => {
		const logger = mock<Logger>();
		let time = 0;
		const report = createArchiveBrokerConsumerStateReporter(logger, () => time);
		const bad = { consumer, stream, inconsistent: true };
		report(bad);
		time = 50;
		report(bad);
		expect(logger.error).toHaveBeenCalledTimes(1);
		time = 60_000;
		report(bad);
		expect(logger.error).toHaveBeenCalledTimes(2);
		report({ ...bad, inconsistent: false });
		expect(logger.info).toHaveBeenCalledTimes(1);
		report(bad);
		expect(logger.error).toHaveBeenCalledTimes(3);
	});
});
