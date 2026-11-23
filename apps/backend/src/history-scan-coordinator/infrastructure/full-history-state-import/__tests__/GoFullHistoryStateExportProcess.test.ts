import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runGoFullHistoryStateExport } from '../GoFullHistoryStateExportProcess.js';

const sourceSha256 = 'e'.repeat(64);
const header = JSON.stringify({
	dataset: 'account-state-changes',
	sourceSha256,
	type: 'header',
	version: 'stellar-atlas.full-history-state-export.v1'
});
const complete = JSON.stringify({
	dataset: 'account-state-changes',
	recordCount: '0',
	type: 'complete'
});

describe('runGoFullHistoryStateExport', () => {
	it('hands the child the exact held descriptor, without reopening a shared cache pathname', async () => {
		const handle = await open(new URL(import.meta.url), 'r');
		try {
			const size = (await handle.stat()).size;
			const data = Buffer.alloc(size);
			await handle.read(data, 0, size, 0);
			const expected = createHash('sha256').update(data).digest('hex');
			await expect(
				runGoFullHistoryStateExport({
					args: [
						'-e',
						`const digest = require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(3)).digest('hex'); process.stdout.write(JSON.stringify({dataset:'account-state-changes',sourceSha256:digest,type:'header', version:'stellar-atlas.full-history-state-export.v1'})+'\\n'+${JSON.stringify(complete + '\n')});`
					],
					inputFd: handle.fd,
					consumeRow: async () => {},
					dataset: 'account-state-changes',
					executablePath: process.execPath,
					expectedSourceSha256: expected,
					signal: new AbortController().signal,
					timeoutMilliseconds: 5000
				})
			).resolves.toEqual({ recordCount: 0n, sourceSha256: expected });
		} finally {
			await handle.close();
		}
	});
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
				expectedSourceSha256: sourceSha256,
				signal: abort.signal,
				timeoutMilliseconds: 5_000
			})
		).resolves.toEqual({ recordCount: 0n, sourceSha256 });
	});

	it('reports bounded child stderr on a nonzero exit', async () => {
		const abort = new AbortController();
		await expect(
			runGoFullHistoryStateExport({
				args: ['-e', `process.stderr.write('export refused');process.exit(7)`],
				consumeRow: () => Promise.resolve(),
				dataset: 'account-state-changes',
				executablePath: process.execPath,
				expectedSourceSha256: sourceSha256,
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
				expectedSourceSha256: sourceSha256,
				signal: abort.signal,
				timeoutMilliseconds: 5_000
			})
		).rejects.toThrow('operator stop');
	});
});
