import { Transform, type TransformCallback } from 'node:stream';

export const archiveObjectCompressedReplayLimit = 1024 * 1024;

export interface ArchiveObjectReplayInput {
	readonly compressed: Buffer | undefined;
	readonly bytesDownloaded: number;
	readonly bytesTotal: number | null;
	readonly httpStatus: number;
}

/** One fixed-size allocation per active probe; never spools to disk. */
export class ArchiveObjectCompressedReplay extends Transform {
	private buffer: Buffer | undefined = Buffer.allocUnsafe(
		archiveObjectCompressedReplayLimit
	);
	private length = 0;

	_transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		if (this.buffer !== undefined) {
			if (chunk.length > this.buffer.length - this.length) {
				this.discard();
			} else {
				chunk.copy(this.buffer, this.length);
				this.length += chunk.length;
			}
		}
		callback(null, chunk);
	}

	takeCapturedBytes(): Buffer | undefined {
		const captured = this.buffer?.subarray(0, this.length);
		this.discard();
		return captured;
	}

	discard(): void {
		this.buffer = undefined;
	}
}
