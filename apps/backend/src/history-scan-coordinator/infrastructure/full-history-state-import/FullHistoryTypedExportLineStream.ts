import {
	FULL_HISTORY_TYPED_EXPORT_MAXIMUM_LINE_BYTES,
	type FullHistoryTypedExportResult,
	type FullHistoryTypedExportSession
} from './FullHistoryTypedExportProtocol.js';

export async function consumeFullHistoryTypedExport<
	D extends string,
	V extends string,
	T
>(
	chunks: AsyncIterable<Uint8Array>,
	session: FullHistoryTypedExportSession<D, V, T>,
	consumeRow: (row: T) => Promise<void>,
	label: string
): Promise<FullHistoryTypedExportResult> {
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

	for await (const input of chunks) {
		const chunk = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
		let start = 0;
		for (;;) {
			const newline = chunk.indexOf(0x0a, start);
			if (newline === -1) break;
			pending = appendBounded(pending, chunk.subarray(start, newline), label);
			await consumeLine(session, decoder, pending, consumeRow);
			pending = Buffer.alloc(0);
			start = newline + 1;
		}
		pending = appendBounded(pending, chunk.subarray(start), label);
	}

	if (pending.byteLength > 0) {
		await consumeLine(session, decoder, pending, consumeRow);
	}
	return session.finish();
}

function appendBounded(
	current: Buffer<ArrayBufferLike>,
	next: Buffer<ArrayBufferLike>,
	label: string
): Buffer<ArrayBufferLike> {
	if (
		current.byteLength + next.byteLength >
		FULL_HISTORY_TYPED_EXPORT_MAXIMUM_LINE_BYTES
	) {
		throw new Error(`${label} NDJSON line exceeded its byte limit`);
	}
	if (current.byteLength === 0) return Buffer.from(next);
	if (next.byteLength === 0) return current;
	return Buffer.concat([current, next], current.byteLength + next.byteLength);
}

async function consumeLine<D extends string, V extends string, T>(
	session: FullHistoryTypedExportSession<D, V, T>,
	decoder: TextDecoder,
	bytes: Buffer<ArrayBufferLike>,
	consumeRow: (row: T) => Promise<void>
): Promise<void> {
	const row = session.acceptLine(decoder.decode(bytes));
	if (row !== null) await consumeRow(row);
}
