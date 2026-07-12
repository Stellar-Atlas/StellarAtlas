import type {
	FullHistoryCanonicalRepository,
	FullHistoryPrependReceipt
} from '../../domain/full-history/FullHistoryCanonicalRepository.js';
import { deterministicFullHistoryBatchId } from '../../domain/full-history-promotion/DeterministicFullHistoryBatchId.js';
import type {
	FullHistoryCheckpointCandidate,
	FullHistoryPromotionTarget
} from '../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import type { FullHistoryCheckpointCandidateRepository } from '../../domain/full-history-promotion/FullHistoryCheckpointCandidateRepository.js';
import type { FullHistoryCheckpointDecoder } from '../../domain/full-history-promotion/FullHistoryCheckpointDecoder.js';
import { FullHistoryPromotionError } from '../../domain/full-history-promotion/FullHistoryPromotionError.js';

export class PrependFullHistoryCheckpoint {
	constructor(
		private readonly candidateRepository: FullHistoryCheckpointCandidateRepository,
		private readonly decoder: FullHistoryCheckpointDecoder,
		private readonly canonicalRepository: FullHistoryCanonicalRepository
	) {}

	async promote(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryPrependReceipt> {
		const candidate = await this.candidateRepository.load(target);
		assertCandidateMatchesTarget(candidate, target);
		const decoded = await this.decoder.decode(
			candidate,
			target.networkPassphrase
		);
		const firstLedger = decoded.ledgers[0];
		const lastLedger = decoded.ledgers.at(-1);
		if (firstLedger === undefined || lastLedger === undefined) {
			throw new FullHistoryPromotionError(
				'candidate-incomplete',
				'Decoder returned no historical ledger rows'
			);
		}

		return this.canonicalRepository.prependCheckpoint({
			archiveUrlIdentity: candidate.proof.archiveUrlIdentity,
			batchId: deterministicFullHistoryBatchId(candidate, this.decoder.version),
			checkpointLedger: candidate.proof.checkpointLedger,
			decoderVersion: this.decoder.version,
			firstLedger: firstLedger.ledgerSequence,
			lastLedger: lastLedger.ledgerSequence,
			ledgers: decoded.ledgers,
			networkPassphrase: candidate.proof.networkPassphrase,
			operations: decoded.operations,
			proofEvaluatedAt: candidate.proof.evaluatedAt,
			proofId: candidate.proof.id,
			proofVersion: candidate.proof.version,
			results: decoded.results,
			sources: candidate.proof.sources,
			transactions: decoded.transactions
		});
	}
}

function assertCandidateMatchesTarget(
	candidate: FullHistoryCheckpointCandidate,
	target: FullHistoryPromotionTarget
): void {
	if (
		candidate.proof.archiveUrlIdentity !== target.archiveUrlIdentity ||
		candidate.proof.checkpointLedger !== target.checkpointLedger.toString()
	) {
		throw new FullHistoryPromotionError(
			'invalid-proof',
			'Loaded historical proof does not match the requested checkpoint'
		);
	}
	if (candidate.proof.networkPassphrase !== target.networkPassphrase) {
		throw new FullHistoryPromotionError(
			'invalid-network-passphrase',
			'Loaded historical proof belongs to a different network'
		);
	}
}
