import 'reflect-metadata';
import { fileURLToPath } from 'node:url';
import { VerifyArchiveObjects } from '../../use-cases/verify-archive-objects/VerifyArchiveObjects.js';
import Kernel from '../Kernel.js';

export interface VerifyArchiveObjectsCliOptions {
	readonly loop: boolean;
}

export function parseVerifyArchiveObjectsCliOptions(
	args: readonly string[]
): VerifyArchiveObjectsCliOptions {
	return {
		loop: args[0] !== '0'
	};
}

export async function runVerifyArchiveObjects(
	options: VerifyArchiveObjectsCliOptions
): Promise<void> {
	const kernel = await Kernel.getInstance();
	const verifyArchiveObjects = kernel.container.get(VerifyArchiveObjects);
	let shuttingDown = false;
	const shutdown = async (): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		await verifyArchiveObjects.releaseActiveObjectJobs();
		await kernel.shutdown();
	};

	process
		.on('SIGTERM', async () => {
			await shutdown();
			process.exit(0);
		})
		.on('SIGINT', async () => {
			await shutdown();
			process.exit(0);
		});

	try {
		await verifyArchiveObjects.execute(options);
	} finally {
		if (!options.loop) await shutdown();
	}
}

export function isMainModule(moduleUrl: string): boolean {
	const invokedPath = process.argv[1];
	return invokedPath !== undefined && fileURLToPath(moduleUrl) === invokedPath;
}
