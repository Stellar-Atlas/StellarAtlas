import { createHash } from 'node:crypto';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../full-history/FullHistoryCanonicalTypes.js';
import { deterministicFullHistoryBatchId } from '../DeterministicFullHistoryBatchId.js';
import type { FullHistoryCheckpointCandidate } from '../FullHistoryCheckpointCandidate.js';

describe('deterministicFullHistoryBatchId', () => {
	it('is stable for immutable provenance and uses a version-8 UUID', () => {
		const candidate = createCandidate();
		const first = deterministicFullHistoryBatchId(candidate, 'decoder/1');
		const second = deterministicFullHistoryBatchId(candidate, 'decoder/1');

		expect(first).toBe(second);
		expect(first).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		);
	});

	it('changes for decoder, proof, source identity, or content digest changes', () => {
		const candidate = createCandidate();
		const original = deterministicFullHistoryBatchId(candidate, 'decoder/1');
		const changedProof = {
			...candidate,
			proof: { ...candidate.proof, version: candidate.proof.version + 1 }
		};
		const changedSource = {
			...candidate,
			proof: {
				...candidate.proof,
				sources: {
					...candidate.proof.sources,
					ledger: {
						...candidate.proof.sources.ledger,
						contentDigest: hash('changed-ledger-content')
					}
				}
			}
		};

		expect(deterministicFullHistoryBatchId(candidate, 'decoder/2')).not.toBe(
			original
		);
		expect(deterministicFullHistoryBatchId(changedProof, 'decoder/1')).not.toBe(
			original
		);
		expect(
			deterministicFullHistoryBatchId(changedSource, 'decoder/1')
		).not.toBe(original);
	});
});

function createCandidate(): FullHistoryCheckpointCandidate {
	return {
		envelopes: [],
		ledgers: [],
		proof: {
			archiveUrlIdentity: 'https://archive.example/history',
			checkpointLedger: fullHistoryLedgerSequence('63'),
			evaluatedAt: new Date('2026-07-11T10:00:00.000Z'),
			id: 42,
			networkPassphrase: 'Fixture network passphrase',
			sources: {
				checkpointState: {
					contentDigest: hash('checkpoint'),
					remoteId: '00000000-0000-8000-8000-000000000001'
				},
				ledger: {
					contentDigest: hash('ledger'),
					remoteId: '00000000-0000-8000-8000-000000000002'
				},
				results: {
					contentDigest: hash('results'),
					remoteId: '00000000-0000-8000-8000-000000000004'
				},
				transactions: {
					contentDigest: hash('transactions'),
					remoteId: '00000000-0000-8000-8000-000000000003'
				}
			},
			version: 5
		},
		results: []
	};
}

function hash(value: string): FullHistoryHash {
	return FullHistoryHash.fromBytes(createHash('sha256').update(value).digest());
}
