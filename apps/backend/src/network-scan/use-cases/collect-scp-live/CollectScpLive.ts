import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { Logger } from '@core/services/Logger.js';
import type { NetworkConfig } from '@core/config/Config.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import { NetworkId } from '../../domain/network/NetworkId.js';
import type { NetworkRepository } from '../../domain/network/NetworkRepository.js';
import { CrawlerService } from '../../domain/node/scan/node-crawl/CrawlerService.js';
import { ScanRepository } from '../../domain/ScanRepository.js';
import { NodeAddressMapper } from '../scan-network/NodeAddressMapper.js';
import { InvalidKnownPeersError } from '../scan-network/InvalidKnownPeersError.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { ScpStatementLiveStore } from '../../domain/scp/ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from '../../domain/scp/ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';
import { ScpStatementReadModelProjector } from '../../domain/scp/ScpStatementReadModelProjector.js';
import { ScpStatementPersistenceBuffer } from '../../domain/scp/ScpStatementPersistenceBuffer.js';
import type { ScanResult } from '../../domain/Scanner.js';

export interface CollectScpLiveResult {
	latestLedger: bigint;
	observedStatements: number;
	processedLedgers: number;
}

export interface CollectScpLiveShutdownResult {
	canonicalDrained: boolean;
	projectionDrained: boolean;
}

@injectable()
export class CollectScpLive {
	private activePersistence: ScpStatementPersistenceBuffer | null = null;
	private shuttingDown = false;
	private latestLedger: bigint | null = null;
	private latestLedgerCloseTime: Date | null = null;
	private lastRetentionCleanupAtMs = 0;
	private readonly projector: ScpStatementReadModelProjector;

	constructor(
		@inject(NETWORK_TYPES.NetworkConfig)
		private networkConfig: NetworkConfig,
		@inject(NETWORK_TYPES.NetworkRepository)
		private networkRepository: NetworkRepository,
		@inject(ScanRepository)
		private scanRepository: ScanRepository,
		private crawlerService: CrawlerService,
		@inject(NETWORK_TYPES.ScpStatementObservationRepository)
		private scpStatementObservationRepository: ScpStatementObservationRepository,
		@inject(NETWORK_TYPES.ScpStatementLiveStore)
		private scpStatementLiveStore: ScpStatementLiveStore,
		@inject('Logger')
		private logger: Logger
	) {
		this.projector = new ScpStatementReadModelProjector(
			this.scpStatementLiveStore,
			this.scpStatementObservationRepository,
			this.logger
		);
	}

	async execute(): Promise<Result<CollectScpLiveResult, Error>> {
		try {
			if (this.shuttingDown) {
				return ok({
					latestLedger: this.latestLedger ?? 0n,
					observedStatements: 0,
					processedLedgers: 0
				});
			}
			this.projector.start();

			const scanDataOrError = await this.scanRepository.findScanDataForUpdate();
			if (scanDataOrError.isErr()) return err(scanDataOrError.error);

			const networkOrError = await this.getNetwork();
			if (networkOrError.isErr()) return err(networkOrError.error);

			const bootstrapNodeAddressesOrError =
				NodeAddressMapper.mapToNodeAddresses(this.networkConfig.knownPeers);
			if (bootstrapNodeAddressesOrError.isErr()) {
				return err(
					new InvalidKnownPeersError(bootstrapNodeAddressesOrError.error)
				);
			}

			const previousScan = scanDataOrError.value;
			if (this.shuttingDown) return ok(this.emptyResult());
			const persistence = new ScpStatementPersistenceBuffer(
				this.scpStatementObservationRepository,
				this.projector,
				this.logger
			);
			this.activePersistence = persistence;
			let flushed = false;
			try {
				const cursor = this.selectCrawlCursor(previousScan);
				const crawlResult = await this.crawlerService.crawl(
					networkOrError.value.quorumSetConfiguration,
					previousScan?.nodeScan.nodes ?? [],
					bootstrapNodeAddressesOrError.value,
					cursor.latestLedger,
					cursor.latestLedgerCloseTime,
					(observation) => persistence.add(observation)
				);
				await persistence.flush();
				flushed = true;
				if (crawlResult.isErr()) return err(crawlResult.error);

				await this.cleanUpRetainedStatements(new Date());

				this.latestLedger = crawlResult.value.latestClosedLedger.sequence;
				this.latestLedgerCloseTime =
					crawlResult.value.latestClosedLedger.closeTime;

				const observedStatements =
					crawlResult.value.scpStatementObservationCount;
				this.logger.info('Live SCP collector crawl finished', {
					latestLedger: this.latestLedger.toString(),
					observedStatements,
					processedLedgers: crawlResult.value.processedLedgers.length
				});

				return ok({
					latestLedger: this.latestLedger,
					observedStatements,
					processedLedgers: crawlResult.value.processedLedgers.length
				});
			} finally {
				try {
					if (!flushed) await persistence.flush();
				} finally {
					if (this.activePersistence === persistence) {
						this.activePersistence = null;
					}
				}
			}
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async shutDown(timeoutMs: number): Promise<CollectScpLiveShutdownResult> {
		this.shuttingDown = true;
		const deadlineMs = Date.now() + Math.max(0, timeoutMs);
		const persistence = this.activePersistence;
		persistence?.close();
		const canonicalDrained =
			persistence === null
				? true
				: await this.settlesSuccessfullyBefore(persistence.flush(), deadlineMs);
		if (!canonicalDrained) {
			this.projector.shutdown();
			return { canonicalDrained: false, projectionDrained: false };
		}

		const projectionDrained = await this.projector.drain(
			Math.max(0, deadlineMs - Date.now())
		);
		return { canonicalDrained: true, projectionDrained };
	}

	private emptyResult(): CollectScpLiveResult {
		return {
			latestLedger: this.latestLedger ?? 0n,
			observedStatements: 0,
			processedLedgers: 0
		};
	}

	private selectCrawlCursor(previousScan: ScanResult | null) {
		const scannerLedger = previousScan?.networkScan.latestLedger ?? null;
		if (
			scannerLedger !== null &&
			(this.latestLedger === null || scannerLedger >= this.latestLedger)
		) {
			return {
				latestLedger: scannerLedger,
				latestLedgerCloseTime:
					previousScan?.networkScan.latestLedgerCloseTime ?? null
			};
		}
		return {
			latestLedger: this.latestLedger,
			latestLedgerCloseTime: this.latestLedgerCloseTime
		};
	}

	private async settlesSuccessfullyBefore(
		operation: Promise<void>,
		deadlineMs: number
	): Promise<boolean> {
		const remainingMs = Math.max(0, deadlineMs - Date.now());
		if (remainingMs === 0) return false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				operation.then(
					() => true,
					(error: unknown) => {
						this.logger.error('Could not drain canonical SCP persistence', {
							errorMessage: mapUnknownToError(error).message
						});
						return false;
					}
				),
				new Promise<boolean>((resolve) => {
					timeout = setTimeout(() => resolve(false), remainingMs);
				})
			]);
		} finally {
			if (timeout !== undefined) clearTimeout(timeout);
		}
	}

	private async getNetwork() {
		const networkId = new NetworkId(this.networkConfig.networkId);
		const network =
			await this.networkRepository.findActiveByNetworkId(networkId);
		if (!network)
			return err(new Error(`Network with id ${networkId} not found`));
		return ok(network);
	}

	private async cleanUpRetainedStatements(now: Date): Promise<void> {
		if (
			now.getTime() - this.lastRetentionCleanupAtMs <
			scpStatementObservationPolicy.cleanupIntervalMs
		) {
			return;
		}
		this.lastRetentionCleanupAtMs = now.getTime();

		try {
			let deleted = 0;
			let projectionEventsDeleted = 0;
			for (
				let batch = 0;
				batch < scpStatementObservationPolicy.maxCleanupBatchesPerRun;
				batch += 1
			) {
				const batchDeleted =
					await this.scpStatementObservationRepository.deleteOlderThan(
						new Date(now.getTime() - scpStatementObservationPolicy.retentionMs),
						scpStatementObservationPolicy.cleanupBatchSize
					);
				deleted += batchDeleted;
				if (batchDeleted < scpStatementObservationPolicy.cleanupBatchSize)
					break;
			}
			for (
				let batch = 0;
				batch < scpStatementObservationPolicy.maxCleanupBatchesPerRun;
				batch += 1
			) {
				const batchDeleted =
					await this.scpStatementObservationRepository.deleteProjectionEventsOlderThan(
						new Date(
							now.getTime() -
								scpStatementObservationPolicy.projectionEventRetentionMs
						),
						scpStatementObservationPolicy.cleanupBatchSize
					);
				projectionEventsDeleted += batchDeleted;
				if (batchDeleted < scpStatementObservationPolicy.cleanupBatchSize)
					break;
			}
			if (deleted > 0) {
				this.logger.info('Deleted retained SCP statement observations', {
					deleted
				});
			}
			if (projectionEventsDeleted > 0) {
				this.logger.info('Deleted retained SCP projection events', {
					deleted: projectionEventsDeleted
				});
			}
		} catch (error) {
			this.logger.error('Could not clean up retained SCP statements', {
				errorMessage: mapUnknownToError(error).message
			});
		}
	}
}
