import type {
	FullHistoryHistoricalBackfillJob,
	FullHistoryHistoricalBackfillRange,
	FullHistoryHistoricalFrontier
} from './FullHistoryHistoricalBackfill.js';
import type { FullHistoryPromotionTarget } from '../full-history-promotion/FullHistoryCheckpointCandidate.js';

export interface ScheduleFullHistoryHistoricalBackfillInput {
	readonly id: string;
	readonly maxAttempts: number;
	readonly networkPassphrase: string;
	readonly range: FullHistoryHistoricalBackfillRange;
}

export interface ClaimFullHistoryHistoricalBackfillInput {
	readonly leaseDurationMs: number;
	readonly networkPassphrase: string;
	readonly workerId: string;
}

export interface OwnedFullHistoryHistoricalBackfillInput {
	readonly id: string;
	readonly leaseToken: string;
	readonly workerId: string;
}

export interface RetryFullHistoryHistoricalBackfillInput extends OwnedFullHistoryHistoricalBackfillInput {
	readonly errorCode: string;
	readonly retryDelayMs: number;
}

export interface WaitForFullHistoryHistoricalProofInput extends OwnedFullHistoryHistoricalBackfillInput {
	readonly retryDelayMs: number;
}

export interface FullHistoryHistoricalBackfillScheduleReceipt {
	readonly created: boolean;
	readonly job: FullHistoryHistoricalBackfillJob;
}

export interface FullHistoryHistoricalBackfillRepository {
	claim(
		input: ClaimFullHistoryHistoricalBackfillInput
	): Promise<FullHistoryHistoricalBackfillJob | null>;
	complete(input: OwnedFullHistoryHistoricalBackfillInput): Promise<void>;
	find(id: string): Promise<FullHistoryHistoricalBackfillJob | null>;
	findBlockingJob(
		networkPassphrase: string
	): Promise<FullHistoryHistoricalBackfillJob | null>;
	findFrontier(
		networkPassphrase: string
	): Promise<FullHistoryHistoricalFrontier | null>;
	findStrictProofTargets(
		networkPassphrase: string,
		checkpointLedger: number,
		maximumTargets: number
	): Promise<readonly FullHistoryPromotionTarget[]>;
	renew(
		input: OwnedFullHistoryHistoricalBackfillInput,
		leaseDurationMs: number
	): Promise<FullHistoryHistoricalBackfillJob>;
	retry(
		input: RetryFullHistoryHistoricalBackfillInput
	): Promise<FullHistoryHistoricalBackfillJob>;
	schedule(
		input: ScheduleFullHistoryHistoricalBackfillInput
	): Promise<FullHistoryHistoricalBackfillScheduleReceipt>;
	waitForProof(
		input: WaitForFullHistoryHistoricalProofInput
	): Promise<FullHistoryHistoricalBackfillJob>;
}
