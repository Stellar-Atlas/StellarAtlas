import type { FullHistoryPrependReceipt } from '../../domain/full-history/FullHistoryCanonicalRepository.js';
import type {
	FullHistoryHistoricalBackfillJob,
	FullHistoryHistoricalBackfillJobState
} from '../../domain/full-history-backfill/FullHistoryHistoricalBackfill.js';
import type {
	FullHistoryHistoricalBackfillRepository,
	OwnedFullHistoryHistoricalBackfillInput
} from '../../domain/full-history-backfill/FullHistoryHistoricalBackfillRepository.js';
import { nextHistoricalBackfillCheckpoint } from '../../domain/full-history-backfill/FullHistoryHistoricalBackfillProgress.js';
import type { FullHistoryPromotionTarget } from '../../domain/full-history-promotion/FullHistoryCheckpointCandidate.js';
import { FullHistoryPromotionError } from '../../domain/full-history-promotion/FullHistoryPromotionError.js';
import { assertInteger } from '../../domain/full-history/FullHistoryCanonicalTypes.js';

export interface FullHistoryHistoricalCheckpointPromoter {
	promote(
		target: FullHistoryPromotionTarget
	): Promise<FullHistoryPrependReceipt>;
}

export type RunFullHistoryBackfillResult =
	| {
			readonly checkpointLedger: number;
			readonly jobId: string;
			readonly jobState: FullHistoryHistoricalBackfillJobState;
			readonly processedCheckpoints: number;
			readonly status: 'evidence-rejected' | 'proof-pending';
	  }
	| {
			readonly jobId: string;
			readonly processedCheckpoints: number;
			readonly status: 'completed';
	  }
	| { readonly status: 'idle' };

export class RunFullHistoryBackfill {
	constructor(
		private readonly repository: FullHistoryHistoricalBackfillRepository,
		private readonly promoter: FullHistoryHistoricalCheckpointPromoter
	) {}

	async execute(input: {
		readonly leaseDurationMs: number;
		readonly maximumProofTargets: number;
		readonly networkPassphrase: string;
		readonly retryDelayMs: number;
		readonly workerId: string;
	}): Promise<RunFullHistoryBackfillResult> {
		const leaseDurationMs = assertInteger(
			input.leaseDurationMs,
			'leaseDurationMs',
			1_000,
			900_000
		);
		const maximumProofTargets = assertInteger(
			input.maximumProofTargets,
			'maximumProofTargets',
			1,
			8
		);
		const retryDelayMs = assertInteger(
			input.retryDelayMs,
			'retryDelayMs',
			0,
			86_400_000
		);
		const job = await this.repository.claim({
			leaseDurationMs,
			networkPassphrase: input.networkPassphrase,
			workerId: input.workerId
		});
		if (job === null) return { status: 'idle' };
		const owner = ownedJob(job);
		let processedCheckpoints = 0;

		for (let step = 0; step <= job.range.checkpointCount; step += 1) {
			const frontier = await this.repository.findFrontier(
				input.networkPassphrase
			);
			if (frontier === null) {
				throw new Error('Canonical lower frontier disappeared during backfill');
			}
			const checkpointLedger = nextHistoricalBackfillCheckpoint(frontier, job);
			if (checkpointLedger === null) {
				await this.repository.complete(owner);
				return { jobId: job.id, processedCheckpoints, status: 'completed' };
			}

			const targets = await this.repository.findStrictProofTargets(
				input.networkPassphrase,
				checkpointLedger,
				maximumProofTargets
			);
			if (targets.length === 0) {
				return this.retryWithStatus(
					owner,
					checkpointLedger,
					processedCheckpoints,
					retryDelayMs,
					'proof-pending'
				);
			}

			const rejected = await this.promoteFromTargets(targets);
			if (rejected !== null) {
				return this.retryWithStatus(
					owner,
					checkpointLedger,
					processedCheckpoints,
					retryDelayMs,
					'evidence-rejected',
					rejected.reason
				);
			}
			processedCheckpoints += 1;
			if (step < job.range.checkpointCount - 1) {
				await this.repository.renew(owner, leaseDurationMs);
			}
		}
		throw new Error('Historical job exceeded its bounded checkpoint range');
	}

	private async promoteFromTargets(
		targets: readonly FullHistoryPromotionTarget[]
	): Promise<FullHistoryPromotionError | null> {
		let rejected: FullHistoryPromotionError | null = null;
		for (const target of targets) {
			try {
				await this.promoter.promote(target);
				return null;
			} catch (error) {
				if (!(error instanceof FullHistoryPromotionError)) throw error;
				rejected = error;
			}
		}
		return rejected;
	}

	private async retryWithStatus(
		owner: OwnedFullHistoryHistoricalBackfillInput,
		checkpointLedger: number,
		processedCheckpoints: number,
		retryDelayMs: number,
		status: 'evidence-rejected' | 'proof-pending',
		reason?: FullHistoryPromotionError['reason']
	): Promise<RunFullHistoryBackfillResult> {
		const retried = await this.repository.retry({
			...owner,
			errorCode:
				status === 'proof-pending'
					? 'proof-pending'
					: `evidence-${reason ?? 'invalid-proof'}`,
			retryDelayMs
		});
		return {
			checkpointLedger,
			jobId: owner.id,
			jobState: retried.state,
			processedCheckpoints,
			status
		};
	}
}

function ownedJob(
	job: FullHistoryHistoricalBackfillJob
): OwnedFullHistoryHistoricalBackfillInput {
	if (job.leaseOwner === null || job.leaseToken === null) {
		throw new Error('Claimed historical job has no durable lease identity');
	}
	return {
		id: job.id,
		leaseToken: job.leaseToken,
		workerId: job.leaseOwner
	};
}
