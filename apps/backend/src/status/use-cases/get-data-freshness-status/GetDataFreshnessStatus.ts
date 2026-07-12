import 'reflect-metadata';
import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Config } from '@core/config/Config.js';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import type { StatusLevel } from '../../domain/StatusTypes.js';

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
	readonly archiveEvidence: ArchiveEvidenceFreshnessProbeDTO;
	/** @deprecated Historical legacy range-scanner freshness; not runtime health. */
	readonly archiveScan: LegacyArchiveScanFreshnessProbeDTO;
}

export interface ArchiveEvidenceFreshnessProbeDTO extends FreshnessProbeDTO {
	readonly drivesPlatformStatus: false;
	readonly drivesRuntimeHealth: false;
	readonly source: 'archive_object_evidence';
}

export interface LegacyArchiveScanFreshnessProbeDTO extends FreshnessProbeDTO {
	readonly deprecated: true;
	readonly drivesPlatformStatus: false;
	readonly drivesRuntimeHealth: false;
	readonly historical: true;
	readonly source: 'legacy_range_scan';
}

const defaultNetworkScanLoopMs = 3 * 60 * 1000;
const defaultArchiveScanStaleAfterMs = 6 * 60 * 60 * 1000;

@injectable()
export class GetDataFreshnessStatus {
	constructor(
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private readonly networkScanRepository: NetworkScanRepository,
		@inject(HISTORY_TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(HISTORY_TYPES.HistoryArchiveScanRepository)
		private readonly scanRepository: ScanRepository,
		@inject('Config') private readonly config: Config,
		@inject('ExceptionLogger') private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(): Promise<Result<DataFreshnessStatusDTO, Error>> {
		const generatedAt = new Date();
		const networkStaleAfterMs = this.getNetworkStaleAfterMs();

		try {
			const [
				latestNetworkScanAt,
				latestArchiveActivityAt,
				latestLegacyArchiveScans
			] = await Promise.all([
				this.networkScanRepository.findLatestSuccessfulScanTime(),
				this.objectRepository.findLatestActivityAt(),
				this.scanRepository.findLatestLimited(1)
			]);
			const networkScan = this.mapFreshnessProbe(
				latestNetworkScanAt ?? null,
				generatedAt,
				networkStaleAfterMs
			);
			const archiveEvidence = {
				...this.mapFreshnessProbe(
					latestArchiveActivityAt,
					generatedAt,
					defaultArchiveScanStaleAfterMs
				),
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				source: 'archive_object_evidence'
			} as const;
			const archiveScan = {
				...this.mapFreshnessProbe(
					latestLegacyArchiveScans[0]?.endDate ?? null,
					generatedAt,
					defaultArchiveScanStaleAfterMs
				),
				deprecated: true,
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				historical: true,
				source: 'legacy_range_scan'
			} as const;

			return ok({
				generatedAt: generatedAt.toISOString(),
				status: networkScan.status,
				networkScan,
				archiveEvidence,
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
