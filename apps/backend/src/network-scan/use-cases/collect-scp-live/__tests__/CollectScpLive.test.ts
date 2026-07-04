import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import type { Logger } from '@core/services/Logger.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { createDummyNetworkProps } from '@network-scan/domain/network/__fixtures__/createDummyNetworkProps.js';
import { Network } from '@network-scan/domain/network/Network.js';
import { NetworkId } from '@network-scan/domain/network/NetworkId.js';
import type { NetworkRepository } from '@network-scan/domain/network/NetworkRepository.js';
import { NodeScan } from '@network-scan/domain/node/scan/NodeScan.js';
import { CrawlerService } from '@network-scan/domain/node/scan/node-crawl/CrawlerService.js';
import { OrganizationScan } from '@network-scan/domain/organization/scan/OrganizationScan.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { ScanResult } from '@network-scan/domain/Scanner.js';
import type { ScanRepository } from '@network-scan/domain/ScanRepository.js';
import type { ScpStatementLiveStore } from '@network-scan/domain/scp/ScpStatementLiveStore.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { CollectScpLive } from '../CollectScpLive.js';

describe('CollectScpLive', () => {
	it('indexes crawl observations in the live SCP store only', async () => {
		const sut = setupSUT();
		const observation = createObservation('11');
		sut.crawlerService.crawl.mockImplementation(
			async (
				_networkQuorumSet,
				_nodes,
				_bootstrapNodeAddresses,
				_latestLedger,
				_latestLedgerCloseTime,
				onScpStatementObservation
			) => {
				onScpStatementObservation?.(observation);
				return ok(createCrawlResult(11n, [11], [observation]));
			}
		);

		const result = await sut.collectScpLive.execute();

		expect(result.isOk()).toBe(true);
		expect(sut.liveStore.saveMany).toHaveBeenCalledWith([observation]);
		expect(sut.crawlerService.crawl).toHaveBeenCalledWith(
			expect.anything(),
			[],
			[expect.objectContaining({ ip: '127.0.0.1', port: 11625 })],
			5n,
			new Date('2026-07-03T00:00:05.000Z'),
			expect.any(Function)
		);
	});

	it('continues the next crawl from the latest observed live ledger', async () => {
		const sut = setupSUT();
		sut.crawlerService.crawl
			.mockResolvedValueOnce(ok(createCrawlResult(11n, [10, 11], [])))
			.mockResolvedValueOnce(ok(createCrawlResult(12n, [12], [])));

		await sut.collectScpLive.execute();
		await sut.collectScpLive.execute();

		expect(sut.crawlerService.crawl.mock.calls[1]?.[3]).toBe(11n);
		expect(sut.crawlerService.crawl.mock.calls[1]?.[4]).toEqual(
			new Date('2026-07-03T00:00:11.000Z')
		);
	});
});

function setupSUT() {
	const config = new ConfigMock();
	config.networkConfig.knownPeers = [['127.0.0.1', 11625]];
	const networkRepository = mock<NetworkRepository>();
	const scanRepository = mock<ScanRepository>();
	const crawlerService = mock<CrawlerService>();
	const liveStore = mock<ScpStatementLiveStore>();
	const logger = mock<Logger>();
	networkRepository.findActiveByNetworkId.mockResolvedValue(createNetwork());
	scanRepository.findScanDataForUpdate.mockResolvedValue(ok(createScanResult()));
	liveStore.saveMany.mockResolvedValue(undefined);

	return {
		collectScpLive: new CollectScpLive(
			config.networkConfig,
			networkRepository,
			scanRepository,
			crawlerService,
			liveStore,
			logger
		),
		crawlerService,
		liveStore
	};
}

function createNetwork(): Network {
	return Network.create(
		new Date('2026-07-03T00:00:00.000Z'),
		new NetworkId('test'),
		'test network',
		createDummyNetworkProps()
	);
}

function createScanResult(): ScanResult {
	const time = new Date('2026-07-03T00:00:00.000Z');
	const networkScan = new NetworkScan(time);
	networkScan.latestLedger = 5n;
	networkScan.latestLedgerCloseTime = new Date('2026-07-03T00:00:05.000Z');
	return {
		networkScan,
		nodeScan: new NodeScan(time, []),
		organizationScan: new OrganizationScan(time, [])
	};
}

function createCrawlResult(
	latestLedger: bigint,
	processedLedgers: number[],
	scpStatementObservations: CrawlerScpStatementObservation[]
) {
	return {
		latestClosedLedger: {
			closeTime: new Date(`2026-07-03T00:00:${latestLedger}.000Z`),
			localCloseTime: new Date(`2026-07-03T00:00:${latestLedger}.100Z`),
			sequence: latestLedger,
			value: `value-${latestLedger}`
		},
		peerNodes: new Map(),
		processedLedgers,
		scpStatementObservations
	};
}

function createObservation(slotIndex: string): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-03T00:00:11.250Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex,
		statementHash: `statement-${slotIndex}`,
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: []
	};
}
