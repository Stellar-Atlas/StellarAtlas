import type { FullHistoryUint64String } from '../full-history/FullHistoryCanonicalTypes.js';

export type FullHistoryPromotionRuntimeState =
	'failed' | 'promoting' | 'running' | 'stopped' | 'waiting-for-proof';

export type FullHistoryPromotionOutcome =
	'bootstrap-required' | 'proof-pending' | 'promoted' | 'replayed';

export interface FullHistoryPromotionRuntimeView {
	readonly checkpointLedger: number | null;
	readonly heartbeatAt: Date;
	readonly instanceId: string;
	readonly lastAttemptAt: Date | null;
	readonly lastErrorCode: string | null;
	readonly lastFailureAt: Date | null;
	readonly lastOutcome: FullHistoryPromotionOutcome | null;
	readonly lastSuccessAt: Date | null;
	readonly nextLedger: FullHistoryUint64String | null;
	readonly startedAt: Date;
	readonly state: FullHistoryPromotionRuntimeState;
}

export interface FullHistoryPromotionRuntimeRepository {
	begin(networkPassphrase: string, instanceId: string): Promise<void>;
	find(
		networkPassphrase: string
	): Promise<FullHistoryPromotionRuntimeView | null>;
	markAttempt(networkPassphrase: string, instanceId: string): Promise<void>;
	recordFailure(
		networkPassphrase: string,
		instanceId: string,
		errorCode: string
	): Promise<void>;
	recordOutcome(
		networkPassphrase: string,
		instanceId: string,
		input: {
			readonly checkpointLedger: number | null;
			readonly nextLedger: FullHistoryUint64String | null;
			readonly outcome: FullHistoryPromotionOutcome;
		}
	): Promise<void>;
	stop(networkPassphrase: string, instanceId: string): Promise<void>;
}
