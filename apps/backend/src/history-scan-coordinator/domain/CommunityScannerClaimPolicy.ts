export const communityScannerClaimPolicy = {
	maxActiveJobsPerScanner: 1,
	minJobsForProductionScore: 5,
	minSuccessRate: 50
} as const;

export type CommunityScannerClaimDenialReason =
	'active_job_limit' | 'blacklisted' | 'production_score';

export interface CommunityScannerClaimState {
	readonly activeJobs: number;
	readonly isBlocked: boolean;
	readonly maxActiveJobs: number;
	readonly successRate: number;
	readonly totalJobsCompleted: number;
	readonly totalJobsFailed: number;
}

export type CommunityScannerClaimDecision =
	| {
			readonly allowed: true;
	  }
	| {
			readonly allowed: false;
			readonly denialReason: CommunityScannerClaimDenialReason;
	  };

export function decideCommunityScannerClaim(
	state: CommunityScannerClaimState
): CommunityScannerClaimDecision {
	if (state.isBlocked) {
		return { allowed: false, denialReason: 'blacklisted' };
	}

	if (state.activeJobs >= state.maxActiveJobs) {
		return { allowed: false, denialReason: 'active_job_limit' };
	}

	const totalJobs = state.totalJobsCompleted + state.totalJobsFailed;
	if (
		totalJobs >= communityScannerClaimPolicy.minJobsForProductionScore &&
		state.successRate < communityScannerClaimPolicy.minSuccessRate
	) {
		return { allowed: false, denialReason: 'production_score' };
	}

	return { allowed: true };
}
