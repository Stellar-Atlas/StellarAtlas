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

	const buildOutputWorkerPath = resolve(
		directory,
		'../../../lib/domain/scanner/hash-worker.js'
	);

	if (existsSync(buildOutputWorkerPath)) {
		return { path: buildOutputWorkerPath, options: {} };
	}

	const sourceWorkerPath = resolve(directory, 'hash-worker.ts');

	if (existsSync(sourceWorkerPath)) {
		return {
			path: sourceWorkerPath,
			options: {
				workerThreadOpts: {
					execArgv: ['--import', createTsNodeEsmRegister()]
				}
			}
		};
	}

	throw new Error(`History scanner worker not found at ${builtWorkerPath}`);
}

function createTsNodeEsmRegister(): string {
	const source =
		'import { register } from "node:module";' +
		'import { pathToFileURL } from "node:url";' +
		'register("ts-node/esm", pathToFileURL("./"));';

	return `data:text/javascript,${encodeURIComponent(source)}`;
}
