import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HasherPool } from '../HasherPool.js';
import { resolveHasherWorker } from '../resolveHasherWorker.js';

jest.setTimeout(30_000);

it('runs malformed XDR through the source-only worker thread', async () => {
	const scannerDirectory = resolve(
		dirname(fileURLToPath(import.meta.url)),
		'..'
	);
	const resolution = resolveHasherWorker(
		pathToFileURL(resolve(scannerDirectory, 'HasherPool.ts')).href
	);

	expect(resolution.path).toBe(resolve(scannerDirectory, 'hash-worker.ts'));
	expect(resolution.path).not.toContain('/lib/');
	expect(resolution.options.workerThreadOpts?.execArgv).toEqual([
		'--experimental-strip-types'
	]);

	const pool = new HasherPool(1);
	try {
		await expect(
			pool.workerpool.exec('processLedgerHeaderHistoryEntryXDR', [
				Buffer.from('not-xdr')
			])
		).rejects.toMatchObject({
			message: 'Invalid ledger header archive XDR',
			name: 'ArchiveXdrError'
		});
	} finally {
		await pool.workerpool.terminate(true);
		pool.terminated = true;
	}
});
