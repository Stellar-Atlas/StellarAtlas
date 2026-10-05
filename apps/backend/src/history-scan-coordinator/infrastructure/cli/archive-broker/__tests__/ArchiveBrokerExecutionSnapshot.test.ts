import type { JetStreamManager } from 'nats';
import { readArchiveBrokerExecutionSnapshot } from '../ArchiveBrokerExecutionSnapshot.js';

function fixture(
	messages = [
		{ seq: 5, executionId: 'old' },
		{ seq: 100, executionId: 'live' }
	]
) {
	const state = { first_seq: 5, last_seq: 100, messages: messages.length };
	const streams = {
		info: jest.fn(async () => ({
			created: 'same',
			config: { retention: 'workqueue', subjects: ['jobs'] },
			state: { ...state }
		})),
		getMessage: jest.fn(async (_stream: string, request: { seq: number }) => {
			const message = messages.find((row) => row.seq >= request.seq);
			if (!message) throw { code: '404' };
			return {
				seq: message.seq,
				data: new TextEncoder().encode(JSON.stringify(message))
			};
		})
	};
	return {
		streams,
		state,
		manager: { streams } as unknown as Pick<JetStreamManager, 'streams'>
	};
}
describe('bounded non-consuming execution snapshot', () => {
	it('enumerates sequence gaps and includes an old pre-floor retained token', async () => {
		const f = fixture();
		const result = await readArchiveBrokerExecutionSnapshot(
			f.manager,
			'stream',
			'jobs',
			240
		);
		expect([...result!.executionIds]).toEqual(['old', 'live']);
		expect(f.streams.getMessage.mock.calls.map((call) => call[1].seq)).toEqual([
			5, 6
		]);
		expect(await result!.confirmUnchanged()).toBe(true);
	});
	it('fails closed when publication changes during enumeration or final confirmation', async () => {
		const f = fixture();
		const result = await readArchiveBrokerExecutionSnapshot(
			f.manager,
			'stream',
			'jobs',
			240
		);
		f.state.last_seq++;
		expect(await result!.confirmUnchanged()).toBe(false);
		f.streams.getMessage.mockImplementation(async () => {
			f.state.last_seq++;
			return { seq: 5, data: new TextEncoder().encode('{"executionId":"x"}') };
		});
		expect(
			await readArchiveBrokerExecutionSnapshot(f.manager, 'stream', 'jobs', 240)
		).toBeNull();
	});
	it('allows concurrent acknowledged deletion only conservatively', async () => {
		const f = fixture();
		const result = await readArchiveBrokerExecutionSnapshot(
			f.manager,
			'stream',
			'jobs',
			240
		);
		f.state.messages = 0;
		expect(await result!.confirmUnchanged()).toBe(true);
		expect(result!.executionIds.has('live')).toBe(true);
	});
	it('rejects over-bound inventory, malformed payloads and transport errors', async () => {
		const f = fixture();
		f.state.messages = 241;
		expect(
			await readArchiveBrokerExecutionSnapshot(f.manager, 'stream', 'jobs', 240)
		).toBeNull();
		expect(f.streams.getMessage).not.toHaveBeenCalled();
		f.state.messages = 1;
		f.streams.getMessage.mockResolvedValue({
			seq: 5,
			data: new TextEncoder().encode('{}')
		});
		expect(
			await readArchiveBrokerExecutionSnapshot(f.manager, 'stream', 'jobs', 240)
		).toBeNull();
		f.streams.getMessage.mockRejectedValue(new Error('disconnected'));
		expect(
			await readArchiveBrokerExecutionSnapshot(f.manager, 'stream', 'jobs', 240)
		).toBeNull();
	});
	it('rejects stream replacement and unavailable final confirmation', async () => {
		const f = fixture();
		const result = await readArchiveBrokerExecutionSnapshot(
			f.manager,
			'stream',
			'jobs',
			240
		);
		f.streams.info.mockResolvedValue({
			created: 'replacement',
			config: { retention: 'workqueue', subjects: ['jobs'] },
			state: f.state
		});
		expect(await result!.confirmUnchanged()).toBe(false);
		f.streams.info.mockRejectedValue(new Error('offline'));
		expect(await result!.confirmUnchanged()).toBe(false);
	});
	it('returns within its deadline when a broker request never resolves', async () => {
		jest.useFakeTimers();
		try {
			const f = fixture();
			f.streams.info.mockImplementation(() => new Promise(() => {}));
			const result = readArchiveBrokerExecutionSnapshot(
				f.manager,
				'stream',
				'jobs',
				240
			);
			await jest.advanceTimersByTimeAsync(1500);
			expect(await result).toBeNull();
		} finally {
			jest.useRealTimers();
		}
	});
});
