import { err } from 'neverthrow';
import { retryArchiveObjectTerminalUpdate } from '../ArchiveObjectTerminalUpdate.js';

describe('retryArchiveObjectTerminalUpdate', () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it('returns a failed terminal update to the broker after bounded retries', async () => {
		jest.useFakeTimers();
		const coordinatorError = new Error('coordinator unavailable');
		const action = jest.fn().mockResolvedValue(err(coordinatorError));
		const onError = jest.fn();

		const update = retryArchiveObjectTerminalUpdate(action, onError);
		const rejection = expect(update).rejects.toBe(coordinatorError);
		await jest.runAllTimersAsync();
		await rejection;

		expect(action).toHaveBeenCalledTimes(3);
		expect(onError).toHaveBeenCalledTimes(3);
	});
});
