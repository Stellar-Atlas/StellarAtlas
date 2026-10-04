import {
	NodeAvailabilityCache,
	type NodeAvailabilityAverages
} from '../NodeAvailabilityCache.js';

const data: NodeAvailabilityAverages = { day: [], month: [] };
const time = new Date('2026-10-04T03:00:00Z');

test('concurrent same-scan requests and later views share one successful refresh', async () => {
	const cache = new NodeAvailabilityCache();
	let release: (value: NodeAvailabilityAverages) => void = () => {};
	const load = jest.fn(
		() =>
			new Promise<NodeAvailabilityAverages>((resolve) => {
				release = resolve;
			})
	);
	const first = cache.get(time, load);
	const second = cache.get(new Date(time), load);
	await Promise.resolve();
	expect(load).toHaveBeenCalledTimes(1);
	release(data);
	expect(await first).toBe(data);
	expect(await second).toBe(data);
	expect(await cache.get(time, load)).toBe(data);
	expect(load).toHaveBeenCalledTimes(1);
});

test('next completed scan and historical timestamp have distinct exact windows', async () => {
	const cache = new NodeAvailabilityCache();
	const load = jest.fn(async () => data);
	await cache.get(time, load);
	await cache.get(new Date(time.getTime() + 60_000), load);
	await cache.get(new Date(time.getTime() - 60_000), load);
	await cache.get(time, load);
	expect(load).toHaveBeenCalledTimes(3);
});

test('failed refreshes are not cached and the next view retries', async () => {
	const cache = new NodeAvailabilityCache();
	const load = jest
		.fn<Promise<NodeAvailabilityAverages>, []>()
		.mockRejectedValueOnce(new Error('query failed'))
		.mockResolvedValue(data);
	await expect(cache.get(time, load)).rejects.toThrow('query failed');
	expect(await cache.get(time, load)).toBe(data);
	expect(load).toHaveBeenCalledTimes(2);
});

test('both retained entries and concurrent distinct refreshes stay bounded', async () => {
	const cache = new NodeAvailabilityCache();
	const load = jest.fn(async () => data);
	for (let index = 0; index < 11; index++)
		await cache.get(new Date(time.getTime() + index), load);
	await cache.get(time, load);
	expect(load).toHaveBeenCalledTimes(12);
	const waiters: Array<(value: NodeAvailabilityAverages) => void> = [];
	const pending = Array.from({ length: 4 }, (_, index) =>
		cache.get(
			new Date(time.getTime() + 100 + index),
			() =>
				new Promise((resolve) => {
					waiters.push(resolve);
				})
		)
	);
	await expect(cache.get(new Date(time.getTime() + 200), load)).rejects.toThrow(
		'capacity'
	);
	for (const resolve of waiters) resolve(data);
	await Promise.all(pending);
});

test('a same-scan entry expires after ten minutes so repaired evidence can refresh', async () => {
	jest.useFakeTimers();
	try {
		const cache = new NodeAvailabilityCache();
		const load = jest.fn(async () => data);
		await cache.get(time, load);
		jest.advanceTimersByTime(10 * 60_000);
		await cache.get(time, load);
		expect(load).toHaveBeenCalledTimes(2);
	} finally {
		jest.useRealTimers();
	}
});
