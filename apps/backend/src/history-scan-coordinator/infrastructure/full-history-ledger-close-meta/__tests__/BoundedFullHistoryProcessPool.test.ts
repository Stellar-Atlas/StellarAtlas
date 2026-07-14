import { BoundedAsyncTaskPool } from '../BoundedAsyncTaskPool.js';

describe('BoundedAsyncTaskPool', () => {
	it('caps simultaneous processing and drains queued work', async () => {
		const pool = new BoundedAsyncTaskPool(2, 2);
		const gates = [deferred(), deferred(), deferred()];
		let maximumActive = 0;
		const tasks = gates.map((gate) =>
			pool.run(new AbortController().signal, async () => {
				maximumActive = Math.max(maximumActive, pool.active);
				await gate.promise;
				return pool.active;
			})
		);

		await Promise.resolve();
		expect(pool.active).toBe(2);
		expect(pool.waiting).toBe(1);
		gates[0]!.resolve();
		await tasks[0];
		expect(pool.active).toBe(2);
		gates[1]!.resolve();
		gates[2]!.resolve();
		await Promise.all(tasks);
		expect(maximumActive).toBe(2);
		expect(pool.active).toBe(0);
	});

	it('removes an aborted queued task', async () => {
		const pool = new BoundedAsyncTaskPool(1, 1);
		const gate = deferred();
		const active = pool.run(new AbortController().signal, () => gate.promise);
		const controller = new AbortController();
		const queued = pool.run(controller.signal, () => Promise.resolve());
		controller.abort(new Error('cancelled'));

		await expect(queued).rejects.toThrow('cancelled');
		expect(pool.waiting).toBe(0);
		gate.resolve();
		await active;
	});

	it('rejects queue growth beyond its configured bound', async () => {
		const pool = new BoundedAsyncTaskPool(1, 1);
		const gate = deferred();
		const active = pool.run(new AbortController().signal, () => gate.promise);
		const queuedGate = deferred();
		const queued = pool.run(
			new AbortController().signal,
			() => queuedGate.promise
		);

		await expect(
			pool.run(new AbortController().signal, () => Promise.resolve())
		).rejects.toThrow(/configured capacity/);
		gate.resolve();
		await active;
		queuedGate.resolve();
		await queued;
	});
});

function deferred(): {
	readonly promise: Promise<void>;
	readonly resolve: () => void;
} {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
