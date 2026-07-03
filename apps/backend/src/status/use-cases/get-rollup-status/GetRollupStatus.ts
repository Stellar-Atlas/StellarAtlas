import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NetworkMeasurementDayRepository } from '@network-scan/domain/network/NetworkMeasurementDayRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

export interface RollupDayStatusDTO {
	readonly day: string;
	readonly status: StatusLevel;
	readonly rawCompletedScans: number;
	readonly rollupCrawlCount: number | null;
	readonly hasRollup: boolean;
	readonly matchesRawCompletedScans: boolean;
}

export interface NetworkRollupStatusDTO {
	readonly status: StatusLevel;
	readonly windowStart: string;
	readonly windowEnd: string;
	readonly windowDays: number;
	readonly rawCompletedScans: number;
	readonly rollupCrawlCount: number;
	readonly daysWithCompletedScans: number;
	readonly daysWithRollups: number;
	readonly matchingDays: number;
	readonly missingRollupDays: number;
	readonly mismatchedRollupDays: number;
	readonly latestRollupDay: string | null;
	readonly days: readonly RollupDayStatusDTO[];
}

export interface RollupStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly networkRollups: NetworkRollupStatusDTO;
}

const rollupStatusWindowDays = 7;
const dayMs = 24 * 60 * 60 * 1000;

@injectable()
export class GetRollupStatus {
	constructor(
		@inject(NETWORK_TYPES.NetworkMeasurementDayRepository)
		private readonly networkMeasurementDayRepository: NetworkMeasurementDayRepository,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<RollupStatusDTO, Error>> {
		const generatedAt = new Date();
		const windowEnd = getUtcDayStart(generatedAt);
		const windowStart = new Date(
			windowEnd.getTime() - rollupStatusWindowDays * dayMs
		);

		try {
			const summaries =
				await this.networkMeasurementDayRepository.findScanRollupSummary(
					windowStart,
					windowEnd
				);
			const networkRollups = this.mapNetworkRollups(
				summaries,
				windowStart,
				windowEnd
			);

			return ok({
				generatedAt: generatedAt.toISOString(),
				status: networkRollups.status,
				networkRollups
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private mapNetworkRollups(
		summaries: readonly {
			readonly day: Date;
			readonly rawCompletedScans: number;
			readonly rollupCrawlCount: number | null;
		}[],
		windowStart: Date,
		windowEnd: Date
	): NetworkRollupStatusDTO {
		const days = summaries.map(mapRollupDay);
		const rawCompletedScans = sum(days, (day) => day.rawCompletedScans);
		const rollupCrawlCount = sum(days, (day) => day.rollupCrawlCount ?? 0);
		const missingRollupDays = days.filter(
			(day) => day.rawCompletedScans > 0 && !day.hasRollup
		).length;
		const mismatchedRollupDays = days.filter(
			(day) => day.hasRollup && !day.matchesRawCompletedScans
		).length;
		const latestRollupDay =
			days
				.filter((day) => day.hasRollup)
				.map((day) => day.day)
				.at(-1) ?? null;

		return {
			status: getNetworkRollupStatus(
				rawCompletedScans,
				rollupCrawlCount,
				missingRollupDays,
				mismatchedRollupDays
			),
			windowStart: windowStart.toISOString(),
			windowEnd: windowEnd.toISOString(),
			windowDays: rollupStatusWindowDays,
			rawCompletedScans,
			rollupCrawlCount,
			daysWithCompletedScans: days.filter((day) => day.rawCompletedScans > 0)
				.length,
			daysWithRollups: days.filter((day) => day.hasRollup).length,
			matchingDays: days.filter((day) => day.matchesRawCompletedScans).length,
			missingRollupDays,
			mismatchedRollupDays,
			latestRollupDay,
			days
		};
	}
}

function mapRollupDay(summary: {
	readonly day: Date;
	readonly rawCompletedScans: number;
	readonly rollupCrawlCount: number | null;
}): RollupDayStatusDTO {
	const hasRollup = summary.rollupCrawlCount !== null;
	const matchesRawCompletedScans =
		hasRollup && summary.rollupCrawlCount === summary.rawCompletedScans;
	const status = getRollupDayStatus(
		summary.rawCompletedScans,
		hasRollup,
		matchesRawCompletedScans
	);

	return {
		day: summary.day.toISOString(),
		status,
		rawCompletedScans: summary.rawCompletedScans,
		rollupCrawlCount: summary.rollupCrawlCount,
		hasRollup,
		matchesRawCompletedScans
	};
}

function getRollupDayStatus(
	rawCompletedScans: number,
	hasRollup: boolean,
	matchesRawCompletedScans: boolean
): StatusLevel {
	if (rawCompletedScans === 0 && !hasRollup) return 'unavailable';
	if (!hasRollup || !matchesRawCompletedScans) return 'degraded';
	return 'ok';
}

function getNetworkRollupStatus(
	rawCompletedScans: number,
	rollupCrawlCount: number,
	missingRollupDays: number,
	mismatchedRollupDays: number
): StatusLevel {
	if (rawCompletedScans === 0 && rollupCrawlCount === 0) return 'unavailable';
	if (missingRollupDays > 0 || mismatchedRollupDays > 0) return 'degraded';
	return 'ok';
}

function getUtcDayStart(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
	);
}

function sum<T>(items: readonly T[], selector: (item: T) => number): number {
	return items.reduce((total, item) => total + selector(item), 0);
}
