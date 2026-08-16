import 'reflect-metadata';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import {
	defaultProofRefreshSeedBatchSize,
	inspectHistoryArchiveCheckpointProofRefreshSeed,
	normalizeProofRefreshSeedBatchSize,
	seedHistoryArchiveCheckpointProofRefreshes
} from '../../repositories/database/HistoryArchiveCheckpointProofRefreshSeed.js';
import { getHistoryArchiveCheckpointProofRefreshQueueStatus } from '../../repositories/database/HistoryArchiveCheckpointProofRefreshQueue.js';

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes('--apply');
const batchSize = normalizeProofRefreshSeedBatchSize(
	Number(readArgument('--batch-size') ?? defaultProofRefreshSeedBatchSize)
);

try {
	await AppDataSource.initialize();
	const result = apply
		? await seedHistoryArchiveCheckpointProofRefreshes(AppDataSource, batchSize)
		: await inspectHistoryArchiveCheckpointProofRefreshSeed(
				AppDataSource,
				batchSize
			);
	const queue =
		await getHistoryArchiveCheckpointProofRefreshQueueStatus(AppDataSource);
	console.log(
		JSON.stringify({
			...result,
			batchSize,
			mode: apply ? 'apply' : 'dry-run',
			queue
		})
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
} finally {
	if (AppDataSource.isInitialized) await AppDataSource.destroy();
}

function readArgument(name: string): string | undefined {
	const prefix = `${name}=`;
	return argumentsList
		.find((value) => value.startsWith(prefix))
		?.slice(prefix.length);
}
