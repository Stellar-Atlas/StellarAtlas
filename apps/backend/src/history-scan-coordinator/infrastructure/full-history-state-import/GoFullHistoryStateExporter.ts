import type { FullHistoryStateExporter } from '../../use-cases/import-next-full-history-state-dataset/ImportNextFullHistoryStateDataset.js';
import { runGoFullHistoryStateExport } from './GoFullHistoryStateExportProcess.js';

export class GoFullHistoryStateExporter implements FullHistoryStateExporter {
	constructor(
		private readonly executablePath: string,
		private readonly timeoutMilliseconds: number
	) {}

	export(
		input: Parameters<FullHistoryStateExporter['export']>[0]
	): Promise<bigint> {
		return runGoFullHistoryStateExport({
			args: ['--dataset', input.claim.dataset, '--input', input.inputPath],
			consumeRow: input.consumeRow,
			dataset: input.claim.dataset,
			executablePath: this.executablePath,
			signal: input.signal,
			timeoutMilliseconds: this.timeoutMilliseconds
		});
	}
}
