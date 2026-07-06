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
import { ScpStatementLiveStoreBuffer } from '../../domain/scp/ScpStatementLiveStoreBuffer.js';

export interface CollectScpLiveResult {
	latestLedger: bigint;
	observedStatements: number;
	processedLedgers: number;
}

const liveBufferBatchSize = 10_000;
const liveBufferFlushDelayMs = 4_500;

@injectable()
export class CollectScpLive {
	private currentLiveStatements: ScpStatementLiveStoreBuffer | null = null;
	private shuttingDown = false;
	private latestLedger: bigint | null = null;
	private latestLedgerCloseTime: Date | null = null;

	constructor(
		@inject(NETWORK_TYPES.NetworkConfig)
		private networkConfig: NetworkConfig,
		@inject(NETWORK_TYPES.NetworkRepository)
		private networkRepository: NetworkRepository,
		@inject(ScanRepository)
		private scanRepository: ScanRepository,
		private crawlerService: CrawlerService,
		@inject(NETWORK_TYPES.ScpStatementLiveStore)
		private scpStatementLiveStore: ScpStatementLiveStore,
		@inject('Logger')
		private logger: Logger
	) {}

	async execute(): Promise<Result<CollectScpLiveResult, Error>> {
		try {
			if (this.shuttingDown) {
				return ok({
					latestLedger: this.latestLedger ?? 0n,
					observedStatements: 0,
					processedLedgers: 0
				});
			}

			const scanDataOrError = await this.scanRepository.findScanDataForUpdate();
			if (scanDataOrError.isErr()) return err(scanDataOrError.error);

			const networkOrError = await this.getNetwork();
			if (networkOrError.isErr()) return err(networkOrError.error);

			const bootstrapNodeAddressesOrError =
				NodeAddressMapper.mapToNodeAddresses(this.networkConfig.knownPeers);
			if (bootstrapNodeAddressesOrError.isErr()) {
				return err(new InvalidKnownPeersError(bootstrapNodeAddressesOrError.error));
			}

			const previousScan = scanDataOrError.value;
			const liveStatements = new ScpStatementLiveStoreBuffer(
				this.scpStatementLiveStore,
				this.logger,
				{
					batchSize: liveBufferBatchSize,
					flushDelayMs: liveBufferFlushDelayMs
				}
			);
			this.currentLiveStatements = liveStatements;

			const crawlResult = await this.crawlerService.crawl(
				networkOrError.value.quorumSetConfiguration,
				previousScan?.nodeScan.nodes ?? [],
				bootstrapNodeAddressesOrError.value,
				this.latestLedger ?? previousScan?.networkScan.latestLedger ?? null,
				this.latestLedgerCloseTime ??
					previousScan?.networkScan.latestLedgerCloseTime ??
					null,
				(observation) => liveStatements.add(observation)
			);
			await liveStatements.flush();

			if (crawlResult.isErr()) return err(crawlResult.error);

			this.latestLedger = crawlResult.value.latestClosedLedger.sequence;
			this.latestLedgerCloseTime = crawlResult.value.latestClosedLedger.closeTime;

			const observedStatements =
				crawlResult.value.scpStatementObservations.length;
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
		} catch (error) {
			return err(mapUnknownToError(error));
		} finally {
			this.currentLiveStatements = null;
		}
	}

	shutDown(): void {
		this.shuttingDown = true;
		this.currentLiveStatements?.abort();
	}

	private async getNetwork() {
		const networkId = new NetworkId(this.networkConfig.networkId);
		const network = await this.networkRepository.findActiveByNetworkId(networkId);
		if (!network) return err(new Error(`Network with id ${networkId} not found`));
		return ok(network);
	}
}
