import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkerPoolOptions } from 'workerpool';

export interface HasherWorkerResolution {
	path: string;
	options: WorkerPoolOptions;
}

export function resolveHasherWorker(moduleUrl: string): HasherWorkerResolution {
	const directory = dirname(fileURLToPath(moduleUrl));
	const builtWorkerPath = resolve(directory, 'hash-worker.js');

	if (existsSync(builtWorkerPath)) {
		return { path: builtWorkerPath, options: {} };
	}

	const sourceWorkerPath = resolve(directory, 'hash-worker.ts');

	if (existsSync(sourceWorkerPath)) {
		return {
			path: sourceWorkerPath,
			options: {
				workerThreadOpts: {
					execArgv: ['--experimental-strip-types']
				}
			}
		};
	}

	throw new Error(
		`History scanner worker not found at ${builtWorkerPath} or ${sourceWorkerPath}`
	);
}
