import { VerifySingleArchive } from '../../use-cases/verify-single-archive/VerifySingleArchive.js';
import Kernel from '../Kernel.js';
import {
	parseScanSingleArchiveArguments,
	scanSingleArchiveUsage
} from './verifySingleArchiveArguments.js';

// noinspection JSIgnoredPromiseFromCall
main();

async function main() {
	let kernel: Kernel | undefined;
	try {
		const dto = parseScanSingleArchiveArguments(process.argv.slice(2));
		kernel = await Kernel.getInstance();
		registerShutdownHandlers(kernel);
		const verifySingleArchive = kernel.container.get(VerifySingleArchive);
		const result = await verifySingleArchive.execute(dto);

		if (result.isErr()) {
			console.error(result.error.message);
			process.exitCode = 1;
		}
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		console.error(scanSingleArchiveUsage);
		process.exitCode = 1;
	} finally {
		await kernel?.shutdown();
	}
}

function registerShutdownHandlers(kernel: Kernel): void {
	const shutdown = async () => {
		await kernel.shutdown();
		process.exit(0);
	};
	process.on('SIGTERM', shutdown).on('SIGINT', shutdown);
}
