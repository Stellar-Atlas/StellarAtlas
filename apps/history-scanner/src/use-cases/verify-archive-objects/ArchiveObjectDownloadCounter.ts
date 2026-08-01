import { Transform } from 'node:stream';

export function createArchiveObjectDownloadCounter(
	onBytes: (bytes: number) => void,
	onComplete: () => Promise<void> | void
): Transform {
	return new Transform({
		flush(callback) {
			void Promise.resolve()
				.then(onComplete)
				.then(
					() => callback(),
					(error: unknown) =>
						callback(error instanceof Error ? error : new Error(String(error)))
				);
		},
		transform(chunk: Buffer, _encoding, callback) {
			onBytes(chunk.length);
			callback(null, chunk);
		}
	});
}
