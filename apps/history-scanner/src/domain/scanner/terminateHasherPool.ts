import { asyncSleep } from 'http-helper';
import type { HasherPool } from './HasherPool.js';
import type { WorkerPoolLoadTracker } from './WorkerPoolLoadTracker.js';

export async function terminateHasherPool(
	poolLoadTracker: WorkerPoolLoadTracker,
	pool: HasherPool
): Promise<void> {
	try {
		poolLoadTracker.stop();
		console.log(
			'Waiting until pool is finished',
			pool.workerpool.stats().activeTasks,
			pool.workerpool.stats().pendingTasks
		);
		while (
			pool.workerpool.stats().pendingTasks > 0 ||
			pool.workerpool.stats().activeTasks > 0
		) {
			await asyncSleep(500);
		}
		await pool.workerpool.terminate(true);
		pool.terminated = true;
	} catch {
		//
	}
}
