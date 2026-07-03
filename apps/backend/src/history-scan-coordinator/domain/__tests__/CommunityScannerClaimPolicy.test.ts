import {
	communityScannerClaimPolicy,
	decideCommunityScannerClaim
} from '../CommunityScannerClaimPolicy.js';

describe('decideCommunityScannerClaim', () => {
	it('should allow a new scanner in probation with no active jobs', () => {
		expect(
			decideCommunityScannerClaim({
				activeJobs: 0,
				isBlacklisted: false,
				maxActiveJobs: communityScannerClaimPolicy.maxActiveJobsPerScanner,
				successRate: 0,
				totalJobsCompleted: 0,
				totalJobsFailed: 0
			})
		).toEqual({ allowed: true });
	});

	it('should deny claims when the scanner already has the active job cap', () => {
		expect(
			decideCommunityScannerClaim({
				activeJobs: communityScannerClaimPolicy.maxActiveJobsPerScanner,
				isBlacklisted: false,
				maxActiveJobs: communityScannerClaimPolicy.maxActiveJobsPerScanner,
				successRate: 100,
				totalJobsCompleted: 10,
				totalJobsFailed: 0
			})
		).toEqual({ allowed: false, denialReason: 'active_job_limit' });
	});

	it('should allow low early success while the scanner is still in probation', () => {
		expect(
			decideCommunityScannerClaim({
				activeJobs: 0,
				isBlacklisted: false,
				maxActiveJobs: communityScannerClaimPolicy.maxActiveJobsPerScanner,
				successRate: 25,
				totalJobsCompleted: 1,
				totalJobsFailed: 2
			})
		).toEqual({ allowed: true });
	});

	it('should deny claims after probation when success rate is too low', () => {
		expect(
			decideCommunityScannerClaim({
				activeJobs: 0,
				isBlacklisted: false,
				maxActiveJobs: communityScannerClaimPolicy.maxActiveJobsPerScanner,
				successRate: communityScannerClaimPolicy.minSuccessRate - 1,
				totalJobsCompleted: 2,
				totalJobsFailed: 3
			})
		).toEqual({ allowed: false, denialReason: 'production_score' });
	});

	it('should deny blacklisted scanners', () => {
		expect(
			decideCommunityScannerClaim({
				activeJobs: 0,
				isBlacklisted: true,
				maxActiveJobs: communityScannerClaimPolicy.maxActiveJobsPerScanner,
				successRate: 100,
				totalJobsCompleted: 10,
				totalJobsFailed: 0
			})
		).toEqual({ allowed: false, denialReason: 'blacklisted' });
	});
});
