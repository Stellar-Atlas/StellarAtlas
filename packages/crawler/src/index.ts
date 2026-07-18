import { Crawler } from './crawler.js';
import pino from 'pino';
import { createNode } from 'node-connector';
import { CrawlerConfiguration } from './crawler-configuration.js';
import { ConnectionManager } from './network-observer/connection-manager.js';
import { CrawlQueueManager } from './crawl-queue-manager.js';
import { AsyncCrawlQueue } from './crawl-queue.js';
import { MaxCrawlTimeManager } from './max-crawl-time-manager.js';
import { CrawlLogger } from './crawl-logger.js';
import { NetworkObserver } from './network-observer/network-observer.js';
import { StellarMessageHandler } from './network-observer/peer-event-handler/stellar-message-handlers/stellar-message-handler.js';
import { Timer } from './utilities/timer.js';
import { ExternalizeStatementHandler } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/externalize-statement-handler.js';
import { ScpStatementHandler } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/scp-statement-handler.js';
import { ScpEnvelopeHandler } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-envelope-handler.js';
import { QuorumSetManager } from './network-observer/quorum-set-manager.js';
import { StragglerTimer } from './network-observer/straggler-timer.js';
import { OnPeerConnected } from './network-observer/peer-event-handler/on-peer-connected.js';
import { OnPeerConnectionClosed } from './network-observer/peer-event-handler/on-peer-connection-closed.js';
import { OnPeerData } from './network-observer/peer-event-handler/on-peer-data.js';
import { ObservationManager } from './network-observer/observation-manager.js';
import { PeerEventHandler } from './network-observer/peer-event-handler/peer-event-handler.js';
import { Timers } from './utilities/timers.js';
import { TimerFactory } from './utilities/timer-factory.js';
import { ConsensusTimer } from './network-observer/consensus-timer.js';
import { ObservationFactory } from './network-observer/observation-factory.js';
import { CrawlFactory } from './crawl-factory.js';

export { Crawler } from './crawler.js';
export type { CrawlResult } from './crawl-result.js';
export { PeerNode } from './peer-node.js';
export { default as jsonStorage } from './utilities/json-storage.js';

export function createLogger(): pino.Logger {
	return pino({
		level: process.env.LOG_LEVEL || 'info',
		base: undefined
	});
}

export function createCrawlFactory(
	config: CrawlerConfiguration,
	logger?: pino.Logger
) {
	if (!logger) {
		logger = createLogger();
	}
	return new CrawlFactory(
		new ObservationFactory(),
		config.nodeConfig.network,
		logger
	);
}

export function createCrawler(
	config: CrawlerConfiguration,
	logger?: pino.Logger
): Crawler {
	if (!logger) {
		logger = createLogger();
	}

	const node = createNode(config.nodeConfig, logger);
	const connectionManager = new ConnectionManager(
		node,
		config.blackList,
		logger
	);
	const quorumSetManager = new QuorumSetManager(
		connectionManager,
		config.quorumSetRequestTimeoutMS,
		logger
	);
	const crawlQueueManager = new CrawlQueueManager(
		new AsyncCrawlQueue(config.maxOpenConnections),
		logger
	);

	const scpEnvelopeHandler = new ScpEnvelopeHandler(
		new ScpStatementHandler(
			quorumSetManager,
			new ExternalizeStatementHandler(logger),
			logger
		)
	);
	const stellarMessageHandler = new StellarMessageHandler(
		scpEnvelopeHandler,
		quorumSetManager,
		logger
	);

	const timers = new Timers(new TimerFactory());
	const stragglerTimer = new StragglerTimer(
		connectionManager,
		timers,
		config.peerStraggleTimeoutMS,
		logger
	);
	const peerEventHandler = new PeerEventHandler(
		new OnPeerConnected(stragglerTimer, connectionManager, logger),
		new OnPeerConnectionClosed(quorumSetManager, logger),
		new OnPeerData(stellarMessageHandler, logger, connectionManager)
	);
	const consensusTimer = new ConsensusTimer(
		new Timer(),
		config.consensusTimeoutMS
	);

	const networkObserverStateManager = new ObservationManager(
		connectionManager,
		consensusTimer,
		stragglerTimer,
		config.syncingTimeoutMS,
		logger
	);
	const peerNetworkManager = new NetworkObserver(
		new ObservationFactory(),
		connectionManager,
		quorumSetManager,
		peerEventHandler,
		networkObserverStateManager
	);

	return new Crawler(
		config,
		crawlQueueManager,
		new MaxCrawlTimeManager(),
		peerNetworkManager,
		new CrawlLogger(connectionManager, crawlQueueManager, logger),
		logger
	);
}
export { CrawlerConfiguration } from './crawler-configuration.js';
export { CrawlFactory } from './crawl-factory.js';
export type { NodeAddress } from './node-address.js';
export type { Ledger } from './crawler.js';
export type {
	ScpStatementObservation,
	StellarValueSummary
} from './network-observer/scp-statement-observation.js';
export { Crawl, CrawlCompletionMode } from './crawl.js';
