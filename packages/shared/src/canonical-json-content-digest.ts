import { createHash } from 'node:crypto';
import type { HistoryArchiveContentDigestFactV1 } from './dto/history-archive-object-verification-facts-v1.js';

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
