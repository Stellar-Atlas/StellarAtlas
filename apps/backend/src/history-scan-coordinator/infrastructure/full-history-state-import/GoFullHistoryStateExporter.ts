import type { FullHistoryStateExporter } from '../../use-cases/import-next-full-history-state-dataset/ImportNextFullHistoryStateDataset.js';
import { fullHistoryLedgerCloseMetaSha256Digest } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import { runGoFullHistoryStateExport } from './GoFullHistoryStateExportProcess.js';
import {
	runGoFullHistoryTypedExport,
	type FullHistoryTypedExportRunner
} from './GoFullHistoryTypedExportProcess.js';

export class GoFullHistoryStateExporter implements FullHistoryStateExporter {
	constructor(
		private readonly executablePath: string,
		private readonly timeoutMilliseconds: number,
		private readonly runExport: FullHistoryTypedExportRunner = runGoFullHistoryTypedExport
	) {}

	export(
		input: Parameters<FullHistoryStateExporter['export']>[0]
	): ReturnType<FullHistoryStateExporter['export']> {
		return runGoFullHistoryStateExport(
			{
				args: ['--dataset', input.claim.dataset, '--input', input.inputPath],
				consumeRow: input.consumeRow,
				dataset: input.claim.dataset,
				executablePath: this.executablePath,
				expectedSourceSha256: input.claim.sourceSha256,
				signal: input.signal,
				timeoutMilliseconds: this.timeoutMilliseconds
			},
			this.runExport
		).then((result) => ({
			recordCount: result.recordCount,
			sourceSha256: fullHistoryLedgerCloseMetaSha256Digest(result.sourceSha256)
		}));
	}
}
