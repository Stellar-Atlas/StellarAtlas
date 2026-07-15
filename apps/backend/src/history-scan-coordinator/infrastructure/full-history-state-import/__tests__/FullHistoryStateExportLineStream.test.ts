import { consumeFullHistoryStateExport } from '../FullHistoryStateExportLineStream.js';

const sourceSha256 = 'd'.repeat(64);
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

describe('consumeFullHistoryStateExport', () => {
	it('parses records split across arbitrary byte chunks', async () => {
		const bytes = Buffer.from(`${header}\n${complete}\n`, 'utf8');
		const chunks = [
			bytes.subarray(0, 7),
			bytes.subarray(7, 41),
			bytes.subarray(41)
		];
		await expect(
			consumeFullHistoryStateExport(
				asChunks(chunks),
				'account-state-changes',
				sourceSha256,
				() => Promise.resolve()
			)
		).resolves.toEqual({ recordCount: 0n, sourceSha256 });
	});

	it('accepts a final completion line without a trailing newline', async () => {
		await expect(
			consumeFullHistoryStateExport(
				asChunks([Buffer.from(`${header}\n${complete}`)]),
				'account-state-changes',
				sourceSha256,
				() => Promise.resolve()
			)
		).resolves.toEqual({ recordCount: 0n, sourceSha256 });
	});

	it('rejects invalid UTF-8 and lines larger than the protocol bound', async () => {
		await expect(
			consumeFullHistoryStateExport(
				asChunks([Buffer.from([0xff, 0x0a])]),
				'account-state-changes',
				sourceSha256,
				() => Promise.resolve()
			)
		).rejects.toThrow();
		await expect(
			consumeFullHistoryStateExport(
				asChunks([Buffer.alloc((1 << 20) + 1, 0x61)]),
				'account-state-changes',
				sourceSha256,
				() => Promise.resolve()
			)
		).rejects.toThrow('byte limit');
	});
});

async function* asChunks(chunks: readonly Buffer[]) {
	for (const chunk of chunks) yield chunk;
}
