import type { Pool } from 'workerpool';
import * as workerpool from 'workerpool';
import * as os from 'os';
import { resolveHasherWorker } from './resolveHasherWorker.js';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class HasherPool {
	public workerpool: Pool;

	public terminated = false;
	constructor() {
		const worker = resolveHasherWorker(import.meta.url);

		this.workerpool = workerpool.pool(worker.path, {
			minWorkers: Math.max((os.cpus().length || 4) - 1, 1),
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
