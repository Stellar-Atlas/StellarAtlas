import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Config } from '@core/config/Config.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export interface NetworkScanStatusDTO {
	readonly status: StatusLevel;
	readonly windowStart: string;
	readonly windowEnd: string;
	readonly windowMs: number;
	readonly scanIntervalMs: number;
	readonly expectedScans: number;
	readonly totalScans: number;
	readonly completedScans: number;
	readonly incompleteScans: number;
	readonly completionRate: number | null;
	readonly expectedCompletionRate: number | null;
	readonly latestScanAt: string | null;
	readonly latestCompletedScanAt: string | null;
}

export interface ScanStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly networkScan: NetworkScanStatusDTO;
}

const defaultNetworkScanLoopMs = 3 * 60 * 1000;
const scanStatusWindowMs = 24 * 60 * 60 * 1000;
const minimumRecordedCompletionRate = 95;
const minimumExpectedCompletionRate = 95;

@injectable()
export class GetScanStatus {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject('Config') private readonly config: Config,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<ScanStatusDTO, Error>> {
		const generatedAt = new Date();
		const windowStart = new Date(generatedAt.getTime() - scanStatusWindowMs);
		const scanIntervalMs = this.getScanIntervalMs();

		try {
			const summary = await this.networkScanRepository.findScanSummary(
				windowStart,
				generatedAt
			);
			const networkScan = this.mapNetworkScanStatus(
				summary,
				windowStart,
				generatedAt,
				scanIntervalMs
			);

			return ok({
				generatedAt: generatedAt.toISOString(),
				status: networkScan.status,
				networkScan
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private mapNetworkScanStatus(
		summary: {
			readonly totalScans: number;
			readonly completedScans: number;
			readonly latestScanAt: Date | null;
			readonly latestCompletedScanAt: Date | null;
		},
		windowStart: Date,
		windowEnd: Date,
		scanIntervalMs: number
	): NetworkScanStatusDTO {
		const expectedScans = Math.max(
			1,
			Math.floor(scanStatusWindowMs / scanIntervalMs)
		);
		const incompleteScans = Math.max(
			0,
			summary.totalScans - summary.completedScans
		);
		const completionRate = toPercentage(
			summary.completedScans,
			summary.totalScans
		);
		const expectedCompletionRate = toPercentage(
			summary.completedScans,
			expectedScans
		);

		return {
			status: getNetworkScanStatus(
				summary.totalScans,
				completionRate,
				expectedCompletionRate
			),
			windowStart: windowStart.toISOString(),
			windowEnd: windowEnd.toISOString(),
			windowMs: scanStatusWindowMs,
			scanIntervalMs,
			expectedScans,
			totalScans: summary.totalScans,
			completedScans: summary.completedScans,
			incompleteScans,
			completionRate,
			expectedCompletionRate,
			latestScanAt: summary.latestScanAt?.toISOString() ?? null,
			latestCompletedScanAt:
				summary.latestCompletedScanAt?.toISOString() ?? null
		};
	}

	private getScanIntervalMs(): number {
		const configuredIntervalMs =
			this.config.networkScanLoopIntervalMs ?? defaultNetworkScanLoopMs;
		return configuredIntervalMs > 0
			? configuredIntervalMs
			: defaultNetworkScanLoopMs;
	}
}

function getNetworkScanStatus(
	totalScans: number,
	completionRate: number | null,
	expectedCompletionRate: number | null
): StatusLevel {
	if (totalScans === 0) return 'unavailable';
	if (
		completionRate !== null &&
		completionRate < minimumRecordedCompletionRate
	) {
		return 'degraded';
	}
	if (
		expectedCompletionRate !== null &&
		expectedCompletionRate < minimumExpectedCompletionRate
	) {
		return 'degraded';
	}
	return 'ok';
}

function toPercentage(numerator: number, denominator: number): number | null {
	if (denominator <= 0) return null;
	return Math.min(100, Math.round((numerator / denominator) * 10000) / 100);
}
