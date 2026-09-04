import 'reflect-metadata';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import {
	backfillSharedCheckpointContentPage,
	defaultSharedCheckpointEligibleBatchSize,
	defaultSharedCheckpointScanBatchSize,
	defaultSharedCheckpointWriteBatchSize,
	inspectSharedCheckpointBackfill,
	normalizeSharedCheckpointEligibleBatchSize,
	normalizeSharedCheckpointScanBatchSize,
	normalizeSharedCheckpointWriteBatchSize
} from '../../repositories/database/HistoryArchiveSharedCheckpointContentBackfill.js';

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes('--apply');
const runAll = argumentsList.includes('--all');
const pageLimit = runAll
	? Number.POSITIVE_INFINITY
	: normalizePageLimit(Number(readArgument('--pages') ?? 1));
const scanBatchSize = normalizeSharedCheckpointScanBatchSize(
	Number(
		readArgument('--scan-batch-size') ?? defaultSharedCheckpointScanBatchSize
	)
);
const eligibleBatchSize = normalizeSharedCheckpointEligibleBatchSize(
	Number(
		readArgument('--eligible-batch-size') ??
			defaultSharedCheckpointEligibleBatchSize
	)
);
const writeBatchSize = normalizeSharedCheckpointWriteBatchSize(
	Number(
		readArgument('--write-batch-size') ?? defaultSharedCheckpointWriteBatchSize
	)
);

try {
	await AppDataSource.initialize();
	if (!apply) {
		console.log(
			JSON.stringify({
				eligibleBatchSize,
				mode: 'dry-run',
				scanBatchSize,
				status: await inspectSharedCheckpointBackfill(AppDataSource),
				writeBatchSize
			})
		);
	} else {
		let pageCount = 0;
		let complete = false;
		let scannedRows = 0;
		let eligibleRows = 0;
		let materializedRows = 0;
		const startedAt = Date.now();
		while (!complete && pageCount < pageLimit) {
			const page = await backfillSharedCheckpointContentPage(
				AppDataSource,
				scanBatchSize,
				writeBatchSize,
				eligibleBatchSize
			);
			pageCount += 1;
			complete = page.complete;
			scannedRows += page.scannedRows;
			eligibleRows += page.eligibleRows;
			materializedRows += page.materializedRows;
			console.log(JSON.stringify({ page: pageCount, ...page }));
		}
		console.log(
			JSON.stringify({
				complete,
				durationMs: Date.now() - startedAt,
				eligibleRows,
				materializedRows,
				mode: 'apply',
				pageCount,
				scannedRows,
				status: await inspectSharedCheckpointBackfill(AppDataSource)
			})
		);
	}
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

function normalizePageLimit(value: number): number {
	if (!Number.isFinite(value)) return 1;
	return Math.max(1, Math.min(10_000, Math.trunc(value)));
}
