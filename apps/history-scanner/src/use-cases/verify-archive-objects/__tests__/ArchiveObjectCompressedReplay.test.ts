import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
	ArchiveObjectCompressedReplay,
	archiveObjectCompressedReplayLimit
} from '../ArchiveObjectCompressedReplay.js';

describe('bounded compressed category replay', () => {
	it('retains exactly the limit with one allocation and transfers ownership once', async () => {
		const replay = new ArchiveObjectCompressedReplay();
		await drain(
			[
				Buffer.alloc(17, 1),
				Buffer.alloc(archiveObjectCompressedReplayLimit - 17, 2)
			],
			replay
		);
		const data = replay.takeCapturedBytes()!;
		expect(data.length).toBe(archiveObjectCompressedReplayLimit);
		expect(data.buffer.byteLength).toBe(archiveObjectCompressedReplayLimit);
		expect(data[16]).toBe(1);
		expect(data[17]).toBe(2);
		expect(replay.takeCapturedBytes()).toBeUndefined();
	});
	it('discards capture immediately on overflow but continues streaming every byte', async () => {
		const replay = new ArchiveObjectCompressedReplay();
		const bytes = await drain(
			[Buffer.alloc(archiveObjectCompressedReplayLimit), Buffer.from('extra')],
			replay
		);
		expect(bytes).toBe(archiveObjectCompressedReplayLimit + 5);
		expect(replay.takeCapturedBytes()).toBeUndefined();
	});
	it('does not expose unused bytes or share buffers between jobs', async () => {
		const left = new ArchiveObjectCompressedReplay();
		const right = new ArchiveObjectCompressedReplay();
		await Promise.all([
			drain([Buffer.from('left')], left),
			drain([Buffer.from('right')], right)
		]);
		expect(left.takeCapturedBytes()?.toString()).toBe('left');
		expect(right.takeCapturedBytes()?.toString()).toBe('right');
	});
});

async function drain(
	chunks: readonly Buffer[],
	replay: ArchiveObjectCompressedReplay
): Promise<number> {
	let bytes = 0;
	await pipeline(
		Readable.from(chunks),
		replay,
		new Writable({
			write(chunk: Buffer, _encoding, done) {
				bytes += chunk.length;
				done();
			}
		})
	);
	return bytes;
}
