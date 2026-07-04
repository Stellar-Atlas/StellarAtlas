import { CrawlerService } from './node-crawl/CrawlerService.js';
import type { CrawlResult } from './node-crawl/CrawlerService.js';
import { inject, injectable } from 'inversify';
import type { Logger } from '@core/services/Logger.js';
import { err, Ok, ok, Result } from 'neverthrow';
import { NetworkQuorumSetConfiguration } from '../../network/NetworkQuorumSetConfiguration.js';
import Node from '../Node.js';
import { NodeScan } from './NodeScan.js';
import type { NodeRepository } from '../NodeRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import PublicKey from '../PublicKey.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { NodeAddress } from '../NodeAddress.js';
import type { ScpStatementObservationRepository } from '../../scp/ScpStatementObservationRepository.js';
import type { ScpStatementLiveStore } from '../../scp/ScpStatementLiveStore.js';
import { ScpStatementLiveStoreBuffer } from '../../scp/ScpStatementLiveStoreBuffer.js';

const liveScpFlushTimeoutMs = 5_000;

@injectable()
export class NodeScannerCrawlStep {
	constructor(
		@inject(NETWORK_TYPES.NodeRepository)
		private nodeRepository: NodeRepository,
		@inject(NETWORK_TYPES.ScpStatementObservationRepository)
		private scpStatementObservationRepository: ScpStatementObservationRepository,
		@inject(NETWORK_TYPES.ScpStatementLiveStore)
		private scpStatementLiveStore: ScpStatementLiveStore,
		private crawlerService: CrawlerService,
		@inject('Logger')
		private logger: Logger
	) {}

	public async execute(
		nodeScan: NodeScan,
		networkQuorumSetConfiguration: NetworkQuorumSetConfiguration,
		previousLatestLedger: bigint | null = null,
		previousLatestLedgerCloseTime: Date | null = null,
		bootstrapNodeAddresses: NodeAddress[] = []
	): Promise<Result<void, Error>> {
		this.logger.info('Starting new node-scan with crawl starting from ledger', {
			previousLatestLedger: previousLatestLedger?.toString(),
			previousLatestLedgerCloseTime:
				previousLatestLedgerCloseTime?.toISOString()
		});
		const liveScpStatements = this.createLiveScpStatementBuffer();
		const crawlResult = await this.crawlerService.crawl(
			networkQuorumSetConfiguration,
			nodeScan.nodes,
			bootstrapNodeAddresses,
			previousLatestLedger,
			previousLatestLedgerCloseTime,
			(observation) => liveScpStatements.add(observation)
		);
		if (crawlResult.isErr()) {
			return err(crawlResult.error);
		}
		this.logger.info('Crawler returned crawl result', {
			peerNodes: crawlResult.value.peerNodes.size,
			processedLedgers: crawlResult.value.processedLedgers.length,
			scpStatementObservations:
				crawlResult.value.scpStatementObservations.length,
			latestClosedLedger:
				crawlResult.value.latestClosedLedger.sequence.toString()
		});
		const liveScpFlush = this.flushLiveScpStatements(liveScpStatements);

		const archivedNodesOrError = await this.fetchRelevantArchivedNodes(
			crawlResult,
			nodeScan
		);

		if (archivedNodesOrError.isErr()) {
			return err(archivedNodesOrError.error);
		}

		const invalidPeerNodes = nodeScan.processCrawl(
			Array.from(crawlResult.value.peerNodes.values()),
			archivedNodesOrError.value,
			crawlResult.value.processedLedgers,
			crawlResult.value.latestClosedLedger.sequence,
			crawlResult.value.latestClosedLedger.closeTime
		);

		await this.persistScpStatementObservations(crawlResult.value);
		await liveScpFlush;

		if (invalidPeerNodes.length > 0)
			this.logger.info('Could not add the following peer-nodes', {
				invalidPeerNodes: invalidPeerNodes
			});

		return ok(undefined);
	}

	private async fetchRelevantArchivedNodes(
		crawlResult: Ok<CrawlResult, Error>,
		nodeScan: NodeScan
	): Promise<Result<Node[], Error>> {
		try {
			const newlyFoundPublicKeyStrings = this.detectNewlyFoundPublicKeysStrings(
				crawlResult.value,
				nodeScan.nodes
			);

			const missingPublicKeys = this.mapToPublicKeys(
				newlyFoundPublicKeyStrings
			);

			if (missingPublicKeys.length > 0)
				return ok(await this.nodeRepository.findByPublicKey(missingPublicKeys));
			return ok([]);
		} catch (e) {
			this.logger.error('Error while fetching archived nodes', { error: e });
			return err(mapUnknownToError(e));
		}
	}

	private mapToPublicKeys(newlyFoundPublicKeyStrings: string[]) {
		return newlyFoundPublicKeyStrings
			.map((publicKey) => {
				const publicKeyOrError = PublicKey.create(publicKey);
				if (publicKeyOrError.isErr()) {
					this.logger.info('crawler returned node with invalid public key', {
						publicKey: publicKey
					});
					return undefined;
				}
				return publicKeyOrError.value;
			})
			.filter((publicKey) => publicKey !== undefined) as PublicKey[];
	}

	private detectNewlyFoundPublicKeysStrings(
		crawlResult: CrawlResult,
		nodes: Node[]
	) {
		return Array.from(crawlResult.peerNodes.keys()).filter(
			(publicKey) => !nodes.find((node) => node.publicKey.value === publicKey)
		);
	}

	private async persistScpStatementObservations(
		crawlResult: CrawlResult
	): Promise<void> {
		try {
			this.logger.info('Saving SCP statement observations', {
				observations: crawlResult.scpStatementObservations.length
			});
			await this.scpStatementObservationRepository.saveMany(
				crawlResult.scpStatementObservations
			);
			this.logger.info('Saved SCP statement observations');
		} catch (error) {
			const mappedError = mapUnknownToError(error);
			this.logger.error('Error while saving SCP statement observations', {
				errorMessage: mappedError.message
			});
		}
	}

	private async flushLiveScpStatements(
		liveScpStatements: ScpStatementLiveStoreBuffer
	): Promise<void> {
		const startTime = Date.now();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const flushPromise = liveScpStatements.flush().then(
			() => 'flushed' as const,
			(error: unknown) => {
				this.logger.error('Error while flushing live SCP statements', {
					errorMessage: mapUnknownToError(error).message
				});
				return 'failed' as const;
			}
		);
		const timeoutPromise = new Promise<'timed_out'>((resolve) => {
			timeout = setTimeout(() => resolve('timed_out'), liveScpFlushTimeoutMs);
		});

		const result = await Promise.race([flushPromise, timeoutPromise]);
		if (timeout !== undefined) clearTimeout(timeout);

		if (result === 'timed_out') {
			this.logger.error('Live SCP statement flush timed out; continuing scan', {
				timeoutMs: liveScpFlushTimeoutMs
			});
			return;
		}

		this.logger.info('Live SCP statement flush finished', {
			status: result,
			durationMs: Date.now() - startTime
		});
	}

	private createLiveScpStatementBuffer(): ScpStatementLiveStoreBuffer {
		return new ScpStatementLiveStoreBuffer(
			this.scpStatementLiveStore,
			this.logger
		);
	}
}
