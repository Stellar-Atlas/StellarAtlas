import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import type { HistoryArchiveContentDigestFactV1 } from 'shared';
export { canonicalJsonContentDigest } from 'shared/lib/canonical-json-content-digest.js';

export class XdrContentDigestTransform extends Transform {
	private readonly hash: Hash = createHash('sha256');
	private finalized = false;

	_transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		callback: TransformCallback
	): void {
		this.hash.update(chunk);
		callback(null, chunk);
	}

	toFact(): HistoryArchiveContentDigestFactV1 {
		if (this.finalized) throw new Error('Content digest is already finalized');
		this.finalized = true;
		return {
			algorithm: 'sha256',
			digest: this.hash.digest('hex'),
			representation: 'uncompressed-xdr'
		};
	}
}
