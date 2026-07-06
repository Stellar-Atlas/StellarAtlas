import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Config } from '@core/config/Config.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { getWorstStatus, type StatusLevel } from '../../domain/StatusTypes.js';

export interface FreshnessProbeDTO {
	readonly status: StatusLevel;
	readonly latestAt: string | null;
	readonly ageMs: number | null;
	readonly staleAfterMs: number | null;
}

export interface DataFreshnessStatusDTO {
	readonly generatedAt: string;
	readonly status: StatusLevel;
	readonly networkScan: FreshnessProbeDTO;
	readonly archiveScan: FreshnessProbeDTO;
}

const defaultNetworkScanLoopMs = 3 * 60 * 1000;
const defaultArchiveScanStaleAfterMs = 6 * 60 * 60 * 1000;

@injectable()
export class GetDataFreshnessStatus {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject(HISTORY_TYPES.HistoryArchiveScanRepository)
		private readonly scanRepository: ScanRepository,
		@inject('Config') private readonly config: Config,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<DataFreshnessStatusDTO, Error>> {
		const generatedAt = new Date();
		const networkStaleAfterMs = this.getNetworkStaleAfterMs();

		try {
			const [latestNetworkScanAt, latestArchiveScans] = await Promise.all([
				this.networkScanRepository.findLatestSuccessfulScanTime(),
				this.scanRepository.findLatestLimited(1)
			]);
			const networkScan = this.mapFreshnessProbe(
				latestNetworkScanAt ?? null,
				generatedAt,
				networkStaleAfterMs
			);
			const archiveScan = this.mapFreshnessProbe(
				latestArchiveScans[0]?.endDate ?? null,
				generatedAt,
				defaultArchiveScanStaleAfterMs
			);

			return ok({
				generatedAt: generatedAt.toISOString(),
				status: getWorstStatus([networkScan.status, archiveScan.status]),
				networkScan,
				archiveScan
			});
		} catch (e) {
			const error = mapUnknownToError(e);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private mapFreshnessProbe(
		latestAt: Date | null,
		generatedAt: Date,
		staleAfterMs: number | null
	): FreshnessProbeDTO {
		if (latestAt === null) {
			return {
				status: 'unavailable',
				latestAt: null,
				ageMs: null,
				staleAfterMs
			};
		}

		const ageMs = Math.max(0, generatedAt.getTime() - latestAt.getTime());
		const status =
			staleAfterMs !== null && ageMs > staleAfterMs ? 'degraded' : 'ok';

		return {
			status,
			latestAt: latestAt.toISOString(),
			ageMs,
			staleAfterMs
		};
	}

	private getNetworkStaleAfterMs(): number {
		const scanLoopMs =
			this.config.networkScanLoopIntervalMs ?? defaultNetworkScanLoopMs;
		const crawlMaxMs = this.config.crawlerConfig.maxCrawlTime;

		return Math.max(scanLoopMs, crawlMaxMs) * 2;
	}
}
