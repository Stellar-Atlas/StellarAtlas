import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

export async function verifiedFullHistoryDatasetPath(
	storageRoot: string,
	storageKey: string,
	expectedDigest: FullHistoryLedgerCloseMetaSha256Digest,
	signal: AbortSignal
): Promise<string> {
	if (signal.aborted) throw asError(signal.reason);
	const root = await realpath(storageRoot);
	const candidate = resolve(root, storageKey);
	if (!candidate.startsWith(`${root}${sep}`)) {
		throw new TypeError('Full-history dataset path escapes its storage root');
	}
	const actual = await realpath(candidate);
	if (!actual.startsWith(`${root}${sep}`)) {
		throw new TypeError(
			'Full-history dataset resolves outside its storage root'
		);
	}
	const info = await stat(actual);
	if (!info.isFile()) throw new TypeError('Full-history dataset is not a file');
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(actual, { signal })) {
		hash.update(chunk);
	}
	const digest = fullHistoryLedgerCloseMetaSha256Digest(hash.digest('hex'));
	if (digest !== expectedDigest) {
		throw new Error('Full-history dataset digest does not match its manifest');
	}
	return actual;
}

function asError(error: unknown): Error {
	return error instanceof Error
		? error
		: new Error('Full-history dataset verification failed', { cause: error });
}
