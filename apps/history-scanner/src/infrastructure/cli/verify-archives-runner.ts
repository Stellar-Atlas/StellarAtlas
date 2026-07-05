import { fileURLToPath } from 'node:url';
import { VerifyArchives } from '../../use-cases/verify-archives/VerifyArchives.js';
import Kernel from '../Kernel.js';

export interface VerifyArchivesCliOptions {
	persist: boolean;
	loop: boolean;
}

export function parseVerifyArchivesCliOptions(
	args: readonly string[]
): VerifyArchivesCliOptions {
	return {
		persist: args[0] === '1',
		loop: args[1] !== '0'
	};
}

export async function runVerifyArchives(
	options: VerifyArchivesCliOptions
): Promise<void> {
	const kernel = await Kernel.getInstance();
	const verifyArchives = kernel.container.get(VerifyArchives);
	const shutdown = async (): Promise<void> => {
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
		await verifyArchives.execute(options);
	} finally {
		if (!options.loop) await shutdown();
	}
}

export function isMainModule(moduleUrl: string): boolean {
	const invokedPath = process.argv[1];
	return invokedPath !== undefined && fileURLToPath(moduleUrl) === invokedPath;
}
