import type { Pool } from 'workerpool';
import * as workerpool from 'workerpool';
import * as os from 'os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class HasherPool {
	public workerpool: Pool;

	public terminated = false;
	constructor() {
		const developmentWorkerPath = fileURLToPath(
			new URL('./hash-worker.import.js', import.meta.url)
		);
		const workerPath = existsSync(developmentWorkerPath)
			? developmentWorkerPath
			: fileURLToPath(new URL('./hash-worker.js', import.meta.url));

		this.workerpool = workerpool.pool(workerPath, {
			minWorkers: Math.max((os.cpus().length || 4) - 1, 1)
		});
	}
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface HasherPool {
	terminated: boolean;
	workerpool: Pool;
}
