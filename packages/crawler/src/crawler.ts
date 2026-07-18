import pino from 'pino';
import { CrawlCompletionMode, CrawlProcessState, Crawl } from './crawl.js';
import type { CrawlResult } from './crawl-result.js';
import { CrawlerConfiguration } from './crawler-configuration.js';
import { CrawlLogger } from './crawl-logger.js';
import { CrawlQueueManager } from './crawl-queue-manager.js';
import { nodeAddressToPeerKey } from './node-address.js';
import type { NodeAddress } from './node-address.js';
import { CrawlTask } from './crawl-task.js';
import { MaxCrawlTimeManager } from './max-crawl-time-manager.js';
import { ClosePayload } from './network-observer/connection-manager.js';
import { NetworkObserver } from './network-observer/network-observer.js';

export interface Ledger {
	sequence: bigint;
	closeTime: Date;
	localCloseTime: Date;
	value: string;
}

/**
 * The crawler is the orchestrator of the crawling process.
 * It connects to nodes, delegates the handling of incoming messages to the StellarMessageHandler,
 * and manages the crawl state.
 */
export class Crawler {
	private _crawl: Crawl | null = null;
	private activeCompletion: {
		reject: (reason?: Error) => void;
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void;
	} | null = null;
	private activeStop: Promise<void> | null = null;
	private stopRequested = false;

	constructor(
		private config: CrawlerConfiguration,
		private crawlQueueManager: CrawlQueueManager,
		private maxCrawlTimeManager: MaxCrawlTimeManager,
		private networkObserver: NetworkObserver,
		private crawlLogger: CrawlLogger,
		public readonly logger: pino.Logger
	) {
		this.logger = logger.child({ mod: 'Crawler' });
		this.setupPeerListenerEvents();
	}

	async startCrawl(crawl: Crawl): Promise<CrawlResult> {
		return new Promise<CrawlResult>((resolve, reject) => {
			if (this.isCrawlRunning()) {
				return reject(new Error('Crawl process already running'));
			}
			this.crawl = crawl;
			this.activeCompletion = { reject, resolve };
			this.activeStop = null;
			this.stopRequested = false;

			this.syncTopTierAndCrawl(resolve, reject);
		});
	}

	async stop(): Promise<void> {
		const completion = this.activeCompletion;
		if (completion === null || !this.isCrawlRunning()) return;
		this.stopRequested = true;
		this.crawl.state = CrawlProcessState.STOPPING;
		this.crawlQueueManager.cancelPendingTasks();
		await this.stopActiveObservation(completion.resolve, completion.reject);
	}

	private isCrawlRunning() {
		return this._crawl && this.crawl.state !== CrawlProcessState.IDLE;
	}

	private setupPeerListenerEvents() {
		this.networkObserver.on('peers', (peers: NodeAddress[]) => {
			this.onPeerAddressesReceived(peers);
		});
		this.networkObserver.on('disconnect', (data: ClosePayload) => {
			this.crawlQueueManager.completeCrawlQueueTask(
				this.crawl.crawlQueueTaskDoneCallbacks,
				data.address
			);

			if (!data.publicKey) {
				this.crawl.failedConnections.push(data.address);
			}

			this.finishPersistentCrawlIfDisconnected();
		});
	}

	private onPeerAddressesReceived(peerAddresses: NodeAddress[]) {
		if (this.crawl.state === CrawlProcessState.TOP_TIER_SYNC) {
			this.crawl.peerAddressesReceivedDuringSync =
				this.crawl.peerAddressesReceivedDuringSync.concat(peerAddresses);
		} else {
			peerAddresses.forEach((peerAddress) => this.crawlPeerNode(peerAddress));
		}
	}

	private async syncTopTierAndCrawl(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: Error) => void
	) {
		const nrOfActiveTopTierConnections = await this.startTopTierSync();
		if (this.stopRequested) return;
		this.startCrawlProcess(resolve, reject, nrOfActiveTopTierConnections);
	}

	private startCrawlProcess(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: Error) => void,
		nrOfActiveTopTierConnections: number
	) {
		const nodesToCrawl = this.crawl.nodesToCrawl.concat(
			this.crawl.peerAddressesReceivedDuringSync
		);

		if (
			this.crawl.nodesToCrawl.length === 0 &&
			nrOfActiveTopTierConnections === 0
		) {
			this.logger.warn(
				'No nodes to crawl and top tier connections closed, crawl failed'
			);
			this.activeCompletion = null;
			this.crawl.state = CrawlProcessState.IDLE;
			reject(new Error('No nodes to crawl and top tier connections failed'));
			return;
		}

		this.logger.info('Starting crawl process');
		this.crawlLogger.start(this.crawl);
		this.crawl.state = CrawlProcessState.CRAWLING;
		this.setupCrawlCompletionHandlers(resolve, reject);

		if (nodesToCrawl.length === 0) {
			this.logger.warn('No nodes to crawl');
			this.crawl.state = CrawlProcessState.STOPPING;
			void this.stopActiveObservation(resolve, reject);
		} else nodesToCrawl.forEach((address) => this.crawlPeerNode(address));
	}

	private async startTopTierSync() {
		this.logger.info('Starting Top Tier sync');
		this.crawl.state = CrawlProcessState.TOP_TIER_SYNC;
		return this.networkObserver.startObservation(this.crawl.observation);
	}

	private setupCrawlCompletionHandlers(
		resolve: (value: PromiseLike<CrawlResult> | CrawlResult) => void,
		reject: (reason?: Error) => void
	) {
		if (this.crawl.completionMode === CrawlCompletionMode.QUEUE_DRAINED) {
			this.startMaxCrawlTimeout(resolve, reject);
		}
		this.crawlQueueManager.onDrain(() => {
			if (this.crawl.completionMode === CrawlCompletionMode.EXPLICIT_STOP) {
				this.logger.info(
					{
						activeConnections: this.networkObserver.getActiveConnectionCount()
					},
					'Peer crawl complete; keeping live observation connected'
				);
				this.finishPersistentCrawlIfDisconnected();
				return;
			}
			this.logger.info('Stopping crawl process');
			this.crawl.state = CrawlProcessState.STOPPING;
			void this.stopActiveObservation(resolve, reject);
		});
	}

	private finishPersistentCrawlIfDisconnected(): void {
		if (
			this.crawl.completionMode !== CrawlCompletionMode.EXPLICIT_STOP ||
			this.crawl.crawlQueueTaskDoneCallbacks.size > 0 ||
			this.crawlQueueManager.queueLength() > 0 ||
			this.networkObserver.getActiveConnectionCount() > 0 ||
			this.crawl.state !== CrawlProcessState.CRAWLING ||
			this.activeCompletion === null
		) {
			return;
		}

		const completion = this.activeCompletion;
		this.logger.warn('Live observation lost all peer connections; restarting');
		this.crawl.state = CrawlProcessState.STOPPING;
		void this.stopActiveObservation(completion.resolve, completion.reject);
	}

	private startMaxCrawlTimeout(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void
	) {
		this.maxCrawlTimeManager.setTimer(this.config.maxCrawlTime, () => {
			this.logger.fatal('Max crawl time hit, closing all connections');
			this.crawl.maxCrawlTimeHit = true;
			this.crawl.state = CrawlProcessState.STOPPING;
			void this.stopActiveObservation(resolve, reject);
		});
	}

	private stopActiveObservation(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void
	): Promise<void> {
		if (this.activeStop !== null) return this.activeStop;

		const stopping = this.networkObserver
			.stop()
			.then(() => this.finish(resolve, reject));
		const tracked = stopping.finally(() => {
			if (this.activeStop === tracked) this.activeStop = null;
		});
		this.activeStop = tracked;
		return tracked;
	}

	private finish(
		resolve: (value: CrawlResult | PromiseLike<CrawlResult>) => void,
		reject: (error: Error) => void
	): void {
		if (this.activeCompletion === null) return;
		this.activeCompletion = null;
		this.crawlLogger.stop();
		this.maxCrawlTimeManager.clearTimer();
		this.crawl.state = CrawlProcessState.IDLE;

		if (this.hasCrawlTimedOut()) {
			//todo clean crawl-queue and connections
			reject(new Error('Max crawl time hit, shutting down crawler'));
			return;
		}

		resolve(this.constructCrawlResult());
	}

	private hasCrawlTimedOut(): boolean {
		return this.crawl.maxCrawlTimeHit;
	}

	private constructCrawlResult(): CrawlResult {
		return {
			peers: this.crawl.observation.peerNodes.getAll(),
			closedLedgers:
				this.crawl.observation.slots.getConfirmedClosedSlotIndexes(),
			latestClosedLedger: this.crawl.observation.latestConfirmedClosedLedger,
			scpStatementObservations: this.crawl.observation.scpStatementObservations
		};
	}

	private crawlPeerNode(nodeAddress: NodeAddress): void {
		const peerKey = nodeAddressToPeerKey(nodeAddress);

		if (!this.canNodeBeCrawled(peerKey)) return;

		this.logNodeAddition(peerKey);
		this.crawl.crawledNodeAddresses.add(peerKey);
		const crawlTask: CrawlTask = {
			nodeAddress: nodeAddress,
			crawl: this.crawl,
			connectCallback: () =>
				this.networkObserver.connectToNode(nodeAddress[0], nodeAddress[1])
		};

		this.crawlQueueManager.addCrawlTask(crawlTask);
	}

	private logNodeAddition(peerKey: string): void {
		this.logger.debug({ peer: peerKey }, 'Adding address to crawl queue');
	}

	private canNodeBeCrawled(peerKey: string): boolean {
		return (
			!this.crawl.crawledNodeAddresses.has(peerKey) &&
			!this.crawl.observation.topTierAddressesSet.has(peerKey)
		);
	}

	private get crawl(): Crawl {
		if (!this._crawl) throw new Error('crawl not set');
		return this._crawl;
	}

	private set crawl(crawl: Crawl) {
		this._crawl = crawl;
	}
}
