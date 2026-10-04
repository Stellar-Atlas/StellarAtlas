import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { FullHistoryCheckpointCandidateRepository } from '../../domain/full-history-promotion/FullHistoryCheckpointCandidateRepository.js';
import type {
	FullHistoryCandidateProof,
	FullHistoryCheckpointCandidate,
	FullHistoryPromotionTarget
} from '../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import {
	FullHistoryLedgerObservationsMissingError,
	FullHistoryPromotionError
} from '../../domain/full-history-promotion/FullHistoryPromotionError.js';
import type { HistoryArchiveRepairObjectArtifactRepository } from '../../domain/history-archive-repair-artifact/HistoryArchiveRepairObjectArtifactRepository.js';
import {
	mapFullHistoryCandidateEnvelope,
	mapFullHistoryCandidateLedger,
	mapFullHistoryCandidateResult,
	validateFullHistoryCandidateLedgerRange
} from '../database/full-history-promotion/FullHistoryCandidateRowMapper.js';
import {
	maximumRawCheckpointBytes,
	type RawCheckpointInput,
	type RawCheckpointRows
} from './FullHistoryRawArchiveCandidateRows.js';

interface ProofCandidateRepository extends FullHistoryCheckpointCandidateRepository {
	loadProof(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryCandidateProof>;
}
type DecodeRaw = (input: RawCheckpointInput) => Promise<RawCheckpointRows>;
const unzip = promisify(gunzip);

/** Optional bridge for retained proofs whose legacy parsed projection is absent. */
export class VerifiedArchiveFullHistoryCheckpointCandidateRepository implements FullHistoryCheckpointCandidateRepository {
	private active = false;
	constructor(
		private readonly parsed: ProofCandidateRepository,
		private readonly artifacts: HistoryArchiveRepairObjectArtifactRepository,
		private readonly decode: DecodeRaw = decodeInWorker
	) {}

	async load(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryCheckpointCandidate> {
		try {
			return await this.parsed.load(target);
		} catch (error) {
			if (!(error instanceof FullHistoryLedgerObservationsMissingError))
				throw error;
		}
		return this.loadFromVerifiedArchives(target);
	}

	/** Explicit bounded recovery/preflight; does not weaken any proof or byte gate. */
	async loadFromVerifiedArchives(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryCheckpointCandidate> {
		if (this.active)
			throw new FullHistoryPromotionError(
				'candidate-incomplete',
				'Raw checkpoint fallback is already active'
			);
		this.active = true;
		try {
			// No transaction or snapshot is held during downloads/CPU work. The normal
			// canonical writer revalidates this exact proof and source digests at commit.
			const proof = await this.parsed.loadProof(target);
			const ledger = await this.readObject(proof, 'ledger');
			const transactions = await this.readObject(proof, 'transactions');
			const results = await this.readObject(proof, 'results');
			const rows = await this.decode({
				checkpointLedger: target.checkpointLedger,
				ledger,
				transactions,
				results
			});
			const candidate = {
				proof,
				ledgers: rows.ledgers.map(mapFullHistoryCandidateLedger),
				envelopes: rows.envelopes.map(mapFullHistoryCandidateEnvelope),
				results: rows.results.map(mapFullHistoryCandidateResult)
			};
			validateFullHistoryCandidateLedgerRange(
				candidate.ledgers,
				target.checkpointLedger
			);
			return candidate;
		} catch (error) {
			if (error instanceof FullHistoryPromotionError) throw error;
			throw new FullHistoryPromotionError(
				'xdr-decode-failed',
				'Verified raw checkpoint recovery failed',
				{ cause: error }
			);
		} finally {
			this.active = false;
		}
	}

	private async readObject(
		proof: FullHistoryCandidateProof,
		category: 'ledger' | 'transactions' | 'results'
	): Promise<Uint8Array> {
		const hex = Number(proof.checkpointLedger).toString(16).padStart(8, '0');
		const root = proof.archiveUrlIdentity.replace(/\/$/, '');
		const objectUrl = `${root}/${category}/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4, 6)}/${category}-${hex}.xdr.gz`;
		const source = proof.sources[category];
		const artifact = await this.artifacts.openVerifiedObject({
			archiveUrl: root,
			archiveUrlIdentity: proof.archiveUrlIdentity,
			objectUrl,
			objectIdentity: source.remoteId,
			contentDigest: source.contentDigest.toHex(),
			contentRepresentation: 'uncompressed-xdr'
		});
		if (artifact.status !== 'available')
			throw new FullHistoryPromotionError(
				'invalid-source-evidence',
				`Raw ${category} artifact unavailable: ${artifact.reason}`
			);
		try {
			const chunks: Buffer[] = [];
			let bytes = 0;
			for await (const chunk of artifact.stream) {
				if (!(chunk instanceof Uint8Array))
					throw new TypeError('Raw archive stream must contain bytes');
				bytes += chunk.byteLength;
				if (bytes > maximumRawCheckpointBytes)
					throw new FullHistoryPromotionError(
						'xdr-bound-exceeded',
						'Compressed archive exceeds recovery bound'
					);
				chunks.push(Buffer.from(chunk));
			}
			const uncompressed = await unzip(Buffer.concat(chunks), {
				maxOutputLength: maximumRawCheckpointBytes
			});
			if (
				createHash('sha256').update(uncompressed).digest('hex') !==
				source.contentDigest.toHex()
			)
				throw new FullHistoryPromotionError(
					'invalid-source-evidence',
					`Raw ${category} bytes do not match proof content digest`
				);
			return uncompressed;
		} finally {
			await artifact.close();
		}
	}
}

async function decodeInWorker(
	input: RawCheckpointInput
): Promise<RawCheckpointRows> {
	const worker = new Worker(
		new URL('./FullHistoryRawArchiveCandidateWorker.js', import.meta.url),
		{
			workerData: input,
			resourceLimits: { maxOldGenerationSizeMb: 1024 }
		}
	);
	let timer: NodeJS.Timeout | undefined;
	try {
		return await new Promise<RawCheckpointRows>((resolve, reject) => {
			timer = setTimeout(
				() => reject(new Error('Raw candidate worker timed out')),
				60_000
			);
			worker.once('error', reject);
			worker.once('exit', (code) =>
				reject(
					new Error(`Raw candidate worker exited without result (${code})`)
				)
			);
			worker.once('message', (message: unknown) => {
				if (
					typeof message !== 'object' ||
					message === null ||
					!('ledgers' in message) ||
					!('envelopes' in message) ||
					!('results' in message) ||
					!Array.isArray(message.ledgers) ||
					!Array.isArray(message.envelopes) ||
					!Array.isArray(message.results)
				) {
					reject(new Error('Invalid local raw candidate worker response'));
					return;
				}
				// Rows originate only in our worker; all persisted fields are validated by
				// existing row mappers and the canonical decoder before any write.
				resolve(message as RawCheckpointRows);
			});
		});
	} finally {
		if (timer !== undefined) clearTimeout(timer);
		await worker.terminate();
	}
}
