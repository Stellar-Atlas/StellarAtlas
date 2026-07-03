import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Repository } from 'typeorm';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import {
	CommunityScanner,
	ScannerStatus
} from '../infrastructure/database/entities/CommunityScanner.js';
import {
	communityScannerHeartbeatFreshnessMs,
	getCommunityScannerHeartbeatCutoff
} from '../domain/CommunityScannerHeartbeat.js';
import { communityScannerClaimPolicy } from '../domain/CommunityScannerClaimPolicy.js';
import {
	getStaleScanJobCutoff,
	staleScanJobAgeMs
} from '../domain/ScanJobStaleness.js';
import { TYPES } from '../infrastructure/di/di-types.js';

export interface ScannerMetrics {
	readonly generatedAt: string;
	readonly heartbeatFreshnessMs: number;
	readonly totalScanners: number;
	readonly activeScanners: number;
	readonly offlineScanners: number;
	readonly degradedScanners: number;
	readonly pendingScanners: number;
	readonly blacklistedScanners: number;
	readonly permanentlyBlacklistedScanners: number;
	readonly temporarilyBlockedScanners: number;
	readonly claimDeniedByBlockedScanners: number;
	readonly claimDeniedByActiveJobLimitScanners: number;
	readonly claimDeniedByProductionScoreScanners: number;
	readonly claimIneligibleScanners: number;
	readonly probationaryScanners: number;
	readonly claimEligibleScanners: number;
	readonly claimPolicyMaxActiveJobsPerScanner: number;
	readonly claimPolicyMinJobsForProductionScore: number;
	readonly claimPolicyMinSuccessRate: number;
	readonly staleScanJobAgeMs: number;
	readonly averageSuccessRate: number;
	readonly totalJobsCompleted: number;
	readonly totalJobsFailed: number;
	readonly averageCompletionTimeMs: number;
}

interface ScannerMetricsRaw {
	readonly totalScanners?: string | number | null;
	readonly activeScanners?: string | number | null;
	readonly offlineScanners?: string | number | null;
	readonly degradedScanners?: string | number | null;
	readonly pendingScanners?: string | number | null;
	readonly blacklistedScanners?: string | number | null;
	readonly permanentlyBlacklistedScanners?: string | number | null;
	readonly temporarilyBlockedScanners?: string | number | null;
	readonly claimDeniedByBlockedScanners?: string | number | null;
	readonly claimDeniedByActiveJobLimitScanners?: string | number | null;
	readonly claimDeniedByProductionScoreScanners?: string | number | null;
	readonly claimIneligibleScanners?: string | number | null;
	readonly probationaryScanners?: string | number | null;
	readonly claimEligibleScanners?: string | number | null;
	readonly avgSuccessRate?: string | number | null;
	readonly totalCompleted?: string | number | null;
	readonly totalFailed?: string | number | null;
	readonly avgCompletionTime?: string | number | null;
}

@injectable()
export class GetScannerMetrics {
	constructor(
		@inject(TYPES.CommunityScannerRepository)
		private readonly scannerRepository: Repository<CommunityScanner>,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<ScannerMetrics, Error>> {
		const generatedAt = new Date();
		const heartbeatCutoff = getCommunityScannerHeartbeatCutoff(generatedAt);
		const staleTakenBefore = getStaleScanJobCutoff(generatedAt);
		const activeJobsExpression =
			'coalesce(active_job_counts."activeJobs", 0)';
		const blockedCondition = `(
			"scanner"."is_blacklisted" = true
			OR coalesce("scanner"."blacklisted_until" > :generatedAt, false)
		)`;
		const productionScoreReadyCondition = `(
			"scanner"."total_jobs_completed" + "scanner"."total_jobs_failed"
		) >= :minJobsForProductionScore`;

		try {
			const aggregateResult = await this.scannerRepository
				.createQueryBuilder('scanner')
				.leftJoin(
					(subQuery) =>
						subQuery
							.select('job."claimedByCommunityScannerId"', 'communityScannerId')
							.addSelect('count(*)', 'activeJobs')
							.from('history_archive_scan_job_queue', 'job')
							.where("job.status = 'TAKEN'")
							.andWhere('job."claimedByCommunityScannerId" is not null')
							.andWhere('job."updatedAt" >= :staleTakenBefore')
							.groupBy('job."claimedByCommunityScannerId"'),
					'active_job_counts',
					'active_job_counts."communityScannerId" = scanner.id'
				)
				.select([
					'COUNT(*) as "totalScanners"',
					`COUNT(*) FILTER (
						WHERE scanner.lastHeartbeatAt > :heartbeatCutoff
						AND scanner.isBlacklisted = false
						AND (
							"scanner"."blacklisted_until" IS NULL
							OR "scanner"."blacklisted_until" <= :generatedAt
						)
					) as "activeScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.lastHeartbeatAt IS NULL
						OR scanner.lastHeartbeatAt <= :heartbeatCutoff
						OR scanner.isBlacklisted = true
						OR "scanner"."blacklisted_until" > :generatedAt
					) as "offlineScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.status = :degradedStatus
					) as "degradedScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.status = :pendingStatus
					) as "pendingScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.isBlacklisted = true
						OR "scanner"."blacklisted_until" > :generatedAt
					) as "blacklistedScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.isBlacklisted = true
					) as "permanentlyBlacklistedScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.isBlacklisted = false
						AND "scanner"."blacklisted_until" > :generatedAt
					) as "temporarilyBlockedScanners"`,
					`COUNT(*) FILTER (
						WHERE ${blockedCondition}
					) as "claimDeniedByBlockedScanners"`,
					`COUNT(*) FILTER (
						WHERE NOT ${blockedCondition}
						AND ${activeJobsExpression} >= :maxActiveJobsPerScanner
					) as "claimDeniedByActiveJobLimitScanners"`,
					`COUNT(*) FILTER (
						WHERE NOT ${blockedCondition}
						AND ${activeJobsExpression} < :maxActiveJobsPerScanner
						AND ${productionScoreReadyCondition}
						AND scanner.successRate < :minSuccessRate
					) as "claimDeniedByProductionScoreScanners"`,
					`COUNT(*) FILTER (
						WHERE ${blockedCondition}
						OR (
							NOT ${blockedCondition}
							AND ${activeJobsExpression} >= :maxActiveJobsPerScanner
						)
						OR (
							NOT ${blockedCondition}
							AND ${activeJobsExpression} < :maxActiveJobsPerScanner
							AND ${productionScoreReadyCondition}
							AND scanner.successRate < :minSuccessRate
						)
					) as "claimIneligibleScanners"`,
					`COUNT(*) FILTER (
						WHERE NOT ${blockedCondition}
						AND NOT ${productionScoreReadyCondition}
					) as "probationaryScanners"`,
					`COUNT(*) FILTER (
						WHERE NOT ${blockedCondition}
						AND ${activeJobsExpression} < :maxActiveJobsPerScanner
						AND (
							NOT ${productionScoreReadyCondition}
							OR scanner.successRate >= :minSuccessRate
						)
					) as "claimEligibleScanners"`,
					'AVG(scanner.successRate) as "avgSuccessRate"',
					'SUM(scanner.totalJobsCompleted) as "totalCompleted"',
					'SUM(scanner.totalJobsFailed) as "totalFailed"',
					'AVG(scanner.averageCompletionTimeMs) as "avgCompletionTime"'
				])
				.setParameters({
					generatedAt,
					heartbeatCutoff,
					staleTakenBefore,
					maxActiveJobsPerScanner:
						communityScannerClaimPolicy.maxActiveJobsPerScanner,
					minJobsForProductionScore:
						communityScannerClaimPolicy.minJobsForProductionScore,
					minSuccessRate: communityScannerClaimPolicy.minSuccessRate,
					degradedStatus: ScannerStatus.DEGRADED,
					pendingStatus: ScannerStatus.PENDING
				})
				.getRawOne<ScannerMetricsRaw>();

			return ok({
				generatedAt: generatedAt.toISOString(),
				heartbeatFreshnessMs: communityScannerHeartbeatFreshnessMs,
				totalScanners: this.parseInteger(aggregateResult?.totalScanners),
				activeScanners: this.parseInteger(aggregateResult?.activeScanners),
				offlineScanners: this.parseInteger(aggregateResult?.offlineScanners),
				degradedScanners: this.parseInteger(aggregateResult?.degradedScanners),
				pendingScanners: this.parseInteger(aggregateResult?.pendingScanners),
				blacklistedScanners: this.parseInteger(
					aggregateResult?.blacklistedScanners
				),
				permanentlyBlacklistedScanners: this.parseInteger(
					aggregateResult?.permanentlyBlacklistedScanners
				),
				temporarilyBlockedScanners: this.parseInteger(
					aggregateResult?.temporarilyBlockedScanners
				),
				claimDeniedByBlockedScanners: this.parseInteger(
					aggregateResult?.claimDeniedByBlockedScanners
				),
				claimDeniedByActiveJobLimitScanners: this.parseInteger(
					aggregateResult?.claimDeniedByActiveJobLimitScanners
				),
				claimDeniedByProductionScoreScanners: this.parseInteger(
					aggregateResult?.claimDeniedByProductionScoreScanners
				),
				claimIneligibleScanners: this.parseInteger(
					aggregateResult?.claimIneligibleScanners
				),
				probationaryScanners: this.parseInteger(
					aggregateResult?.probationaryScanners
				),
				claimEligibleScanners: this.parseInteger(
					aggregateResult?.claimEligibleScanners
				),
				claimPolicyMaxActiveJobsPerScanner:
					communityScannerClaimPolicy.maxActiveJobsPerScanner,
				claimPolicyMinJobsForProductionScore:
					communityScannerClaimPolicy.minJobsForProductionScore,
				claimPolicyMinSuccessRate: communityScannerClaimPolicy.minSuccessRate,
				staleScanJobAgeMs,
				averageSuccessRate: this.parseFloat(aggregateResult?.avgSuccessRate),
				totalJobsCompleted: this.parseInteger(aggregateResult?.totalCompleted),
				totalJobsFailed: this.parseInteger(aggregateResult?.totalFailed),
				averageCompletionTimeMs: this.parseFloat(
					aggregateResult?.avgCompletionTime
				)
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private parseInteger(value: string | number | null | undefined): number {
		if (value === null || value === undefined) return 0;
		return parseInt(String(value), 10);
	}

	private parseFloat(value: string | number | null | undefined): number {
		if (value === null || value === undefined) return 0;
		return Number.parseFloat(String(value));
	}
}
