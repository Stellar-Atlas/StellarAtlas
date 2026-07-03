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

		try {
			const aggregateResult = await this.scannerRepository
				.createQueryBuilder('scanner')
				.select([
					'COUNT(*) as "totalScanners"',
					`COUNT(*) FILTER (
						WHERE scanner.lastHeartbeatAt > :heartbeatCutoff
						AND scanner.isBlacklisted = false
						AND (
							scanner.blacklistedUntil IS NULL
							OR scanner.blacklistedUntil <= :generatedAt
						)
					) as "activeScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.lastHeartbeatAt IS NULL
						OR scanner.lastHeartbeatAt <= :heartbeatCutoff
						OR scanner.isBlacklisted = true
						OR scanner.blacklistedUntil > :generatedAt
					) as "offlineScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.status = :degradedStatus
					) as "degradedScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.status = :pendingStatus
					) as "pendingScanners"`,
					`COUNT(*) FILTER (
						WHERE scanner.isBlacklisted = true
						OR scanner.blacklistedUntil > :generatedAt
					) as "blacklistedScanners"`,
					'AVG(scanner.successRate) as "avgSuccessRate"',
					'SUM(scanner.totalJobsCompleted) as "totalCompleted"',
					'SUM(scanner.totalJobsFailed) as "totalFailed"',
					'AVG(scanner.averageCompletionTimeMs) as "avgCompletionTime"'
				])
				.setParameters({
					generatedAt,
					heartbeatCutoff,
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
