import { fullHistoryLedgerCloseMetaSha256Digest } from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerExporter } from '../../use-cases/bind-next-full-history-state-coverage/BindNextFullHistoryStateCoverage.js';
import { consumeFullHistoryLedgerExport } from './FullHistoryLedgerExportProtocol.js';
import {
	runGoFullHistoryTypedExport,
	type FullHistoryTypedExportRunner
} from './GoFullHistoryTypedExportProcess.js';

export class GoFullHistoryLedgerExporter {
	constructor(
		private readonly executablePath: string,
		private readonly timeoutMilliseconds: number,
		private readonly runExport: FullHistoryTypedExportRunner = runGoFullHistoryTypedExport
	) {}

	export(
		input: Parameters<FullHistoryLedgerExporter['export']>[0]
	): ReturnType<FullHistoryLedgerExporter['export']> {
		return this.runExport({
			args: ['--dataset', 'ledgers', '--input', input.inputPath],
			consumeOutput: (output) =>
				consumeFullHistoryLedgerExport(
					output,
					input.expectedSourceSha256,
					input.consumeRow
				),
			executablePath: this.executablePath,
			label: 'Ledger exporter',
			signal: input.signal,
			timeoutMilliseconds: this.timeoutMilliseconds
		}).then((result) => ({
			recordCount: result.recordCount,
			sourceSha256: fullHistoryLedgerCloseMetaSha256Digest(result.sourceSha256)
		}));
	}
}
