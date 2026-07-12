import { createHash } from 'node:crypto';
import {
	assertBoundedText,
	hashNetworkPassphrase
} from '../full-history/FullHistoryCanonicalTypes.js';
import type {
	FullHistoryCandidateSourceObject,
	FullHistoryCheckpointCandidate
} from './FullHistoryCheckpointCandidate.js';

const batchIdentityVersion = 'full-history-checkpoint-batch/v1';

export function deterministicFullHistoryBatchId(
	candidate: FullHistoryCheckpointCandidate,
	decoderVersion: string
): string {
	const proof = candidate.proof;
	const hash = createHash('sha256');
	const append = (value: string): void => {
		const bytes = Buffer.from(value, 'utf8');
		const length = Buffer.allocUnsafe(4);
		length.writeUInt32BE(bytes.length);
		hash.update(length).update(bytes);
	};
	const appendSource = (source: FullHistoryCandidateSourceObject): void => {
		append(source.remoteId);
		append(source.contentDigest.toHex());
	};

	append(batchIdentityVersion);
	append(assertBoundedText(decoderVersion, 'decoderVersion', 128));
	append(proof.archiveUrlIdentity);
	append(proof.checkpointLedger);
	append(hashNetworkPassphrase(proof.networkPassphrase).toHex());
	append(proof.id.toString());
	append(proof.version.toString());
	append(proof.evaluatedAt.toISOString());
	appendSource(proof.sources.checkpointState);
	appendSource(proof.sources.ledger);
	appendSource(proof.sources.transactions);
	appendSource(proof.sources.results);

	const bytes = hash.digest().subarray(0, 16);
	bytes[6] = (bytes[6]! & 0x0f) | 0x80;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
