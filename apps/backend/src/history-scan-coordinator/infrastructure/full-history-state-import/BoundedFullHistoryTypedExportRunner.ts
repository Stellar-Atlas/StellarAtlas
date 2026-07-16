import { BoundedAsyncTaskPool } from '../full-history-ledger-close-meta/BoundedAsyncTaskPool.js';
import {
	runGoFullHistoryTypedExport,
	type FullHistoryTypedExportRunner
} from './GoFullHistoryTypedExportProcess.js';

export function createBoundedFullHistoryTypedExportRunner(
	maximumConcurrency: number,
	maximumQueueDepth: number,
	runExport: FullHistoryTypedExportRunner = runGoFullHistoryTypedExport
): FullHistoryTypedExportRunner {
	const pool = new BoundedAsyncTaskPool(maximumConcurrency, maximumQueueDepth);
	return (request) => pool.run(request.signal, () => runExport(request));
}
