import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { jest } from '@jest/globals';
import {
	decodeRawCheckpoint,
	readArchiveFrames
} from '../FullHistoryRawArchiveCandidateRows.js';
import { VerifiedArchiveFullHistoryCheckpointCandidateRepository } from '../VerifiedArchiveFullHistoryCheckpointCandidateRepository.js';
import { StellarFullHistoryCheckpointDecoder } from '../StellarFullHistoryCheckpointDecoder.js';
import {
	FullHistoryLedgerObservationsMissingError,
	FullHistoryPromotionError
} from '../../../domain/full-history-promotion/FullHistoryPromotionError.js';
import {
	FullHistoryHash,
	fullHistoryLedgerSequence
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { deterministicFullHistoryBatchId } from '../../../domain/full-history-promotion/DeterministicFullHistoryBatchId.js';
import type {
	FullHistoryCandidateProof,
	FullHistoryCheckpointCandidate
} from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type {
	HistoryArchiveRepairObjectArtifactInput,
	OpenHistoryArchiveRepairObjectArtifactResult
} from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';

const categories = ['ledger', 'transactions', 'results'] as const;
const fixtureRoot = 'apps/history-scanner/src/domain/scanner/__fixtures__';
const compressed = Object.fromEntries(
	categories.map((key) => [key, readFileSync(`${fixtureRoot}/${key}.xdr.gz`)])
) as Record<(typeof categories)[number], Buffer>;
const raw = {
	checkpointLedger: 556863,
	...Object.fromEntries(
		categories.map((key) => [key, gunzipSync(compressed[key])])
	)
} as {
	checkpointLedger: number;
	ledger: Buffer;
	transactions: Buffer;
	results: Buffer;
};
const target = {
	archiveUrlIdentity: 'https://archive.example',
	checkpointLedger: 556863,
	networkPassphrase: 'Public Global Stellar Network ; September 2015'
};
const source = (index: number, bytes: Buffer) => ({
	remoteId: `00000000-0000-4000-8000-00000000000${index}`,
	contentDigest: FullHistoryHash.fromBytes(
		createHash('sha256').update(bytes).digest()
	)
});
const proof: FullHistoryCandidateProof = {
	...target,
	checkpointLedger: fullHistoryLedgerSequence('556863'),
	id: 10,
	version: 10,
	evaluatedAt: new Date('2026-01-01T00:00:00Z'),
	sources: {
		checkpointState: source(1, Buffer.from('state')),
		ledger: source(2, raw.ledger),
		transactions: source(3, raw.transactions),
		results: source(4, raw.results)
	}
};
const missing = () =>
	new FullHistoryLedgerObservationsMissingError({
		checkpointLedger: 556863,
		ledgerObjectRemoteId: proof.sources.ledger.remoteId,
		expectedLedgerCount: 64,
		observedLedgerCount: 0
	});

function setup() {
	const parsed = {
		load: jest
			.fn<() => Promise<FullHistoryCheckpointCandidate>>()
			.mockRejectedValue(missing()),
		loadProof: jest
			.fn<() => Promise<FullHistoryCandidateProof>>()
			.mockResolvedValue(proof)
	};
	const close = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
	const openVerifiedObject = jest
		.fn<
			(
				input: HistoryArchiveRepairObjectArtifactInput
			) => Promise<OpenHistoryArchiveRepairObjectArtifactResult>
		>()
		.mockImplementation(async (input) => {
			const key = categories.find(
				(category) => input.objectIdentity === proof.sources[category].remoteId
			)!;
			return {
				status: 'available',
				byteLength: compressed[key].length,
				close,
				stream: Readable.from([compressed[key]]),
				contentDigest: input.contentDigest,
				contentRepresentation: 'uncompressed-xdr',
				fileName: `${key}.xdr.gz`,
				mediaType: 'application/gzip',
				objectIdentity: input.objectIdentity,
				provenAt: new Date()
			};
		});
	const repository =
		new VerifiedArchiveFullHistoryCheckpointCandidateRepository(
			parsed,
			{ openVerifiedObject },
			async (input) => decodeRawCheckpoint(input)
		);
	return { parsed, close, openVerifiedObject, repository };
}

it('recovers the exact real checkpoint without parsed writes and retains canonical decode/idempotence', async () => {
	const { repository, close, openVerifiedObject } = setup();
	const candidate = await repository.load(target);
	expect(candidate.ledgers).toHaveLength(64);
	expect(candidate.envelopes.length).toBeGreaterThan(0);
	expect(candidate.envelopes).toHaveLength(candidate.results.length);
	expect(candidate.ledgers[0]!.closedAt.toISOString()).toBe(
		'2015-11-03T22:54:05.000Z'
	);
	expect(close).toHaveBeenCalledTimes(3);
	expect(
		openVerifiedObject.mock.calls.map(([input]) => input.contentDigest)
	).toEqual(categories.map((key) => proof.sources[key].contentDigest.toHex()));
	const decoder = new StellarFullHistoryCheckpointDecoder();
	const decoded = await decoder.decode(candidate, target.networkPassphrase);
	expect(decoded.ledgers).toHaveLength(64);
	expect(decoded.transactions).toHaveLength(candidate.envelopes.length);
	expect(deterministicFullHistoryBatchId(candidate, decoder.version)).toBe(
		deterministicFullHistoryBatchId(
			await repository.load(target),
			decoder.version
		)
	);
});

it('never falls back for an invalid proof or for a complete parsed candidate', async () => {
	const { parsed, repository, openVerifiedObject } = setup();
	parsed.load.mockRejectedValueOnce(
		new FullHistoryPromotionError('invalid-proof', 'Not verified')
	);
	await expect(repository.load(target)).rejects.toMatchObject({
		reason: 'invalid-proof'
	});
	expect(openVerifiedObject).not.toHaveBeenCalled();
	const candidate = { proof, ledgers: [], envelopes: [], results: [] };
	parsed.load.mockResolvedValueOnce(candidate);
	expect(await repository.load(target)).toBe(candidate);
	expect(openVerifiedObject).not.toHaveBeenCalled();
});

it('rejects a changed proof digest even if an artifact reader claims availability, and closes the handle', async () => {
	const { parsed, repository, close } = setup();
	parsed.loadProof.mockResolvedValue({
		...proof,
		sources: { ...proof.sources, ledger: source(2, Buffer.from('different')) }
	});
	await expect(repository.load(target)).rejects.toMatchObject({
		reason: 'invalid-source-evidence'
	});
	expect(close).toHaveBeenCalledTimes(1);
});

it('does not convert unavailable source content into success', async () => {
	const { repository, openVerifiedObject } = setup();
	openVerifiedObject.mockResolvedValue({
		status: 'unavailable',
		reason: 'content-hash-mismatch',
		retryable: false,
		retryAfterSeconds: null
	});
	await expect(repository.load(target)).rejects.toMatchObject({
		reason: 'invalid-source-evidence'
	});
});

it('explicit raw preflight avoids parsed queries but still requires a fresh validated proof', async () => {
	const { parsed, repository, openVerifiedObject } = setup();
	const candidate = await repository.loadFromVerifiedArchives(target);
	expect(candidate.ledgers).toHaveLength(64);
	expect(parsed.load).not.toHaveBeenCalled();
	expect(parsed.loadProof).toHaveBeenCalledWith(target);
	openVerifiedObject.mockClear();
	parsed.loadProof.mockRejectedValueOnce(
		new FullHistoryPromotionError('invalid-proof', 'Stale proof')
	);
	await expect(
		repository.loadFromVerifiedArchives(target)
	).rejects.toMatchObject({ reason: 'invalid-proof' });
	expect(openVerifiedObject).not.toHaveBeenCalled();
});

it('rejects a bad embedded ledger hash, truncated frames, and wrong checkpoint range', () => {
	const ledger = Buffer.from(raw.ledger);
	ledger[4] = ledger[4]! ^ 255;
	expect(() => decodeRawCheckpoint({ ...raw, ledger })).toThrow(
		'ledger header hash mismatch'
	);
	expect(() =>
		readArchiveFrames(raw.ledger.subarray(0, raw.ledger.length - 1))
	).toThrow('Invalid or excessive archive records');
	expect(() =>
		decodeRawCheckpoint({ ...raw, checkpointLedger: 556927 })
	).toThrow('Unordered raw ledger range');
});

it('rejects missing nonempty categories and duplicate category ledgers', () => {
	expect(() =>
		decodeRawCheckpoint({ ...raw, results: Buffer.alloc(0) })
	).toThrow('omitted empty result set mismatch');
	expect(() =>
		decodeRawCheckpoint({ ...raw, transactions: Buffer.alloc(0) })
	).toThrow('omitted empty transaction set mismatch');
	const first = readArchiveFrames(raw.transactions)[0]!;
	const marker = Buffer.alloc(4);
	marker.writeUInt32BE(first.length);
	expect(() =>
		decodeRawCheckpoint({
			...raw,
			transactions: Buffer.concat([raw.transactions, marker, first])
		})
	).toThrow('Duplicate or out-of-range transaction ledger');
});
