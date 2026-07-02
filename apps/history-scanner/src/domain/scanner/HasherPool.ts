import type { Pool } from 'workerpool';
import * as workerpool from 'workerpool';
import { resolveHasherWorker } from './resolveHasherWorker.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class HasherPool {
	public workerpool: Pool;

	public terminated = false;
	constructor(workerCount: number) {
		const worker = resolveHasherWorker(import.meta.url);

		this.workerpool = workerpool.pool(worker.path, {
			minWorkers: workerCount,
			maxWorkers: workerCount,
			workerType: 'thread',
			...worker.options
		});
	}
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface HasherPool {
	terminated: boolean;
	workerpool: Pool;
}
