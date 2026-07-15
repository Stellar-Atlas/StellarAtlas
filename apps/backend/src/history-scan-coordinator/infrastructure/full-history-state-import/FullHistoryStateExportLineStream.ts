import type {
	FullHistoryStateChange,
	FullHistoryStateDataset
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';
import {
	FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES,
	FullHistoryStateExportSession
} from './FullHistoryStateExportProtocol.js';

export type FullHistoryStateRowConsumer = (
	row: FullHistoryStateChange
) => Promise<void>;

export async function consumeFullHistoryStateExport(
	chunks: AsyncIterable<Uint8Array>,
	dataset: FullHistoryStateDataset,
	consumeRow: FullHistoryStateRowConsumer
): Promise<bigint> {
	const session = new FullHistoryStateExportSession(dataset);
	const decoder = new TextDecoder('utf-8', { fatal: true });
	let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);

	for await (const input of chunks) {
		const chunk = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
		let start = 0;
		for (;;) {
			const newline = chunk.indexOf(0x0a, start);
			if (newline === -1) break;
			const segment = chunk.subarray(start, newline);
			pending = appendBounded(pending, segment);
			await consumeLine(session, decoder, pending, consumeRow);
			pending = Buffer.alloc(0);
			start = newline + 1;
		}
		pending = appendBounded(pending, chunk.subarray(start));
	}

	if (pending.byteLength > 0) {
		await consumeLine(session, decoder, pending, consumeRow);
	}
	return session.finish();
}

function appendBounded(
	current: Buffer<ArrayBufferLike>,
	next: Buffer<ArrayBufferLike>
): Buffer<ArrayBufferLike> {
	if (
		current.byteLength + next.byteLength >
		FULL_HISTORY_STATE_EXPORT_MAXIMUM_LINE_BYTES
	) {
		throw new Error('State exporter NDJSON line exceeded its byte limit');
	}
	if (current.byteLength === 0) return Buffer.from(next);
	if (next.byteLength === 0) return current;
	return Buffer.concat([current, next], current.byteLength + next.byteLength);
}

async function consumeLine(
	session: FullHistoryStateExportSession,
	decoder: TextDecoder,
	bytes: Buffer<ArrayBufferLike>,
	consumeRow: FullHistoryStateRowConsumer
): Promise<void> {
	const row = session.acceptLine(decoder.decode(bytes));
	if (row !== null) await consumeRow(row);
}
