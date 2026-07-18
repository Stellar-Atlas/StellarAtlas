import { CrawlerService } from '../CrawlerService.js';
import { Crawler, CrawlCompletionMode, PeerNode } from 'crawler';
import type { ScpStatementObservation } from 'crawler';
import { mock } from 'jest-mock-extended';
import { NetworkQuorumSetConfiguration } from '@network-scan/domain/network/NetworkQuorumSetConfiguration.js';
import {
	createDummyPublicKey,
	createDummyPublicKeyString
} from '@network-scan/domain/node/__fixtures__/createDummyPublicKey.js';
import type { CrawlResult } from 'crawler';
import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import { createDummyNodeAddress } from '@network-scan/domain/node/__fixtures__/createDummyNodeAddress.js';
import { CrawlFactory } from 'crawler';

describe('CrawlerService', function () {
	it('should crawl', async function () {
		const crawler = mock<Crawler>();
		const crawlFactory = mock<CrawlFactory>();
		const crawlResult = createCrawlResult();
		crawler.startCrawl.mockResolvedValue(crawlResult);

		const crawlerService = new CrawlerService(crawler, crawlFactory);

		const result = await crawlerService.crawl(
			createDummyNetworkQuorumSet(),
			[createDummyNode()],
			[createDummyNodeAddress()],
			BigInt(1),
			new Date()
		);

		expect(result.isOk()).toBeTruthy();
		if (!result.isOk()) throw result.error;
		expect(result.value.peerNodes).toEqual(crawlResult.peers);
		expect(result.value.processedLedgers[0]).toEqual(
			Number(crawlResult.closedLedgers[0])
		);
		expect(result.value.latestClosedLedger).toEqual(
			crawlResult.latestClosedLedger
		);
	});

	it('should return error if no nodes and no bootstrap node addresses are passed', async function () {
		const crawler = mock<Crawler>();
		const crawlFactory = mock<CrawlFactory>();
		const crawlerService = new CrawlerService(crawler, crawlFactory);

		const result = await crawlerService.crawl(
			createDummyNetworkQuorumSet(),
			[],
			[],
			BigInt(1),
			new Date()
		);

		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error).toBeInstanceOf(Error);
	});

	it('should return error if crawler throws Error', async function () {
		const crawler = mock<Crawler>();
		const crawlFactory = mock<CrawlFactory>();
		crawler.startCrawl.mockRejectedValue(new Error('test error'));

		const crawlerService = new CrawlerService(crawler, crawlFactory);

		const result = await crawlerService.crawl(
			createDummyNetworkQuorumSet(),
			[createDummyNode()],
			[createDummyNodeAddress()],
			BigInt(1),
			new Date()
		);

		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error).toBeInstanceOf(Error);
	});

	it('should return error if crawl result did not connect successfully to a single peer', async function () {
		const crawler = mock<Crawler>();
		const crawlFactory = mock<CrawlFactory>();
		const crawlResult = createCrawlResult();
		crawlResult.peers.clear();
		crawler.startCrawl.mockResolvedValue(crawlResult);

		const crawlerService = new CrawlerService(crawler, crawlFactory);

		const result = await crawlerService.crawl(
			createDummyNetworkQuorumSet(),
			[createDummyNode()],
			[createDummyNodeAddress()],
			BigInt(1),
			new Date()
		);

		expect(result.isErr()).toBeTruthy();
		if (!result.isErr()) throw new Error('Expected error but got ok');
		expect(result.error).toBeInstanceOf(Error);
	});

	it('should count streamed observations without retaining them in the crawl result', async () => {
		const crawler = mock<Crawler>();
		const crawlFactory = mock<CrawlFactory>();
		const observation = createObservation();
		const onObservation = jest.fn(async () => undefined);
		crawler.startCrawl.mockImplementation(async () => {
			const listener = crawlFactory.createCrawl.mock.calls[0]?.[5];
			await listener?.(observation);
			return createCrawlResult();
		});
		const crawlerService = new CrawlerService(crawler, crawlFactory);

		const result = await crawlerService.crawl(
			createDummyNetworkQuorumSet(),
			[createDummyNode()],
			[createDummyNodeAddress()],
			1n,
			new Date(),
			onObservation
		);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.scpStatementObservationCount).toBe(1);
		expect(result.value.scpStatementObservations).toEqual([]);
		expect(onObservation).toHaveBeenCalledWith(observation);
	});

	it('keeps only an explicitly requested live observation connected', async () => {
		const crawler = mock<Crawler>();
		const crawlFactory = mock<CrawlFactory>();
		crawler.startCrawl.mockResolvedValue(createCrawlResult());
		const crawlerService = new CrawlerService(crawler, crawlFactory);

		await crawlerService.crawl(
			createDummyNetworkQuorumSet(),
			[createDummyNode()],
			[createDummyNodeAddress()],
			1n,
			new Date(),
			undefined,
			{ keepObservationConnected: true }
		);

		expect(crawlFactory.createCrawl.mock.calls[0]?.[6]).toBe(
			CrawlCompletionMode.EXPLICIT_STOP
		);
	});

	function createDummyNetworkQuorumSet(): NetworkQuorumSetConfiguration {
		return new NetworkQuorumSetConfiguration(1, [createDummyPublicKey()], []);
	}

	function createCrawlResult(): CrawlResult {
		const crawlResultPublicKey = createDummyPublicKeyString();
		const crawlResultCloseTime = new Date('2020-01-01');
		const crawlResultPeerNode = new PeerNode(crawlResultPublicKey);
		crawlResultPeerNode.ip = 'localhost';
		crawlResultPeerNode.successfullyConnected = true;
		return {
			peers: new Map([[crawlResultPublicKey, crawlResultPeerNode]]),
			closedLedgers: [BigInt(1)],
			latestClosedLedger: {
				sequence: BigInt(1),
				closeTime: crawlResultCloseTime,
				value: 'value',
				localCloseTime: crawlResultCloseTime
			},
			scpStatementObservations: []
		};
	}

	function createObservation(): ScpStatementObservation {
		return {
			nodeId: createDummyPublicKeyString(),
			observedAt: new Date('2026-07-10T12:00:00.000Z'),
			observedFromAddress: '127.0.0.1:11625',
			observedFromPeer: createDummyPublicKeyString(),
			pledges: {} as ScpStatementObservation['pledges'],
			signature: 'signature',
			slotIndex: '1',
			statementHash: 'statement-hash',
			statementType: 'externalize',
			statementXdr: 'xdr',
			values: []
		};
	}
});
