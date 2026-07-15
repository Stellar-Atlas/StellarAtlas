import { runGoFullHistoryStateExport } from '../GoFullHistoryStateExportProcess.js';

const header = JSON.stringify({
	dataset: 'account-state-changes',
	type: 'header',
	version: 'stellar-atlas.full-history-state-export.v1'
});
const complete = JSON.stringify({
	dataset: 'account-state-changes',
	recordCount: '0',
	type: 'complete'
});

describe('runGoFullHistoryStateExport', () => {
	it('streams a bounded child process without a shell', async () => {
		const abort = new AbortController();
		await expect(
			runGoFullHistoryStateExport({
				args: [
					'-e',
					`process.stdout.write(${JSON.stringify(`${header}\n${complete}\n`)})`
				],
				consumeRow: () => Promise.resolve(),
				dataset: 'account-state-changes',
				executablePath: process.execPath,
				signal: abort.signal,
				timeoutMilliseconds: 5_000
			})
		).resolves.toBe(0n);
	});

	it('reports bounded child stderr on a nonzero exit', async () => {
		const abort = new AbortController();
		await expect(
			runGoFullHistoryStateExport({
				args: ['-e', `process.stderr.write('export refused');process.exit(7)`],
				consumeRow: () => Promise.resolve(),
				dataset: 'account-state-changes',
				executablePath: process.execPath,
				signal: abort.signal,
				timeoutMilliseconds: 5_000
			})
		).rejects.toThrow('exited with 7: export refused');
	});

	it('refuses an aborted request before spawning', async () => {
		const abort = new AbortController();
		abort.abort(new Error('operator stop'));
		await expect(
			runGoFullHistoryStateExport({
				args: [],
				consumeRow: () => Promise.resolve(),
				dataset: 'account-state-changes',
				executablePath: process.execPath,
				signal: abort.signal,
				timeoutMilliseconds: 5_000
			})
		).rejects.toThrow('operator stop');
	});
});
