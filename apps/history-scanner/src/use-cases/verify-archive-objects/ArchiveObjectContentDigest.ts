import { createHash, type Hash } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import type { HistoryArchiveContentDigestFactV1 } from 'shared';

export function canonicalJsonContentDigest(
	value: unknown
): HistoryArchiveContentDigestFactV1 {
	return {
		algorithm: 'sha256',
		digest: createHash('sha256')
			.update(JSON.stringify(sortJson(value)))
			.digest('hex'),
		representation: 'canonical-json'
	};
}

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

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (!isRecord(value)) return value;

	return Object.fromEntries(
		Object.keys(value)
			.toSorted()
			.map((key) => [key, sortJson(value[key])])
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
