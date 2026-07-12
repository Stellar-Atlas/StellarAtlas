import { NodeScannerCrawlStep } from '../NodeScannerCrawlStep.js';
import { CrawlerService } from '../node-crawl/CrawlerService.js';
import { mock } from 'jest-mock-extended';
import type { NodeRepository } from '../../NodeRepository.js';
import type { Logger } from 'logger';
import { NodeScan } from '../NodeScan.js';
import { createDummyNode } from '../../__fixtures__/createDummyNode.js';
import { NetworkQuorumSetConfiguration } from '@network-scan/domain/network/NetworkQuorumSetConfiguration.js';
import { err, ok } from 'neverthrow';
import { createDummyPublicKey } from '../../__fixtures__/createDummyPublicKey.js';
import Node from '../../Node.js';
import { PeerNode } from 'crawler';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { ScpStatementObservationRepository } from '@network-scan/domain/scp/ScpStatementObservationRepository.js';

describe('NodeScannerCrawlStep', () => {
	const nodeRepository = mock<NodeRepository>();
	const scpStatementObservationRepository =
		mock<ScpStatementObservationRepository>();
	const crawlerService = mock<CrawlerService>();

	const time = new Date();
	const activeNode = createDummyNode();
	const newlyFoundPublicKey = createDummyPublicKey();
	crawlerService.crawl.mockResolvedValue(
		ok({
			latestClosedLedger: {
				sequence: BigInt(1),
				closeTime: new Date(),
				value: 'value',
				localCloseTime: new Date()
			},
			peerNodes: new Map([
				[activeNode.publicKey.value, new PeerNode(activeNode.publicKey.value)],
				[newlyFoundPublicKey.value, new PeerNode(newlyFoundPublicKey.value)]
			]),
			processedLedgers: [1],
			scpStatementObservationCount: 0,
			scpStatementObservations: []
		})
	);

	const nodeScan = new NodeScan(time, [activeNode]);

	const crawlStep = new NodeScannerCrawlStep(
		nodeRepository,
		scpStatementObservationRepository,
		crawlerService,
		mock<Logger>()
	);

	beforeEach(() => {
		jest.clearAllMocks();
		scpStatementObservationRepository.saveMany.mockImplementation(
			async (observations) => [...observations]
		);
	});

	it('should execute a crawl', async function () {
		nodeRepository.findByPublicKey.mockResolvedValue([]);
		const result = await crawlStep.execute(
			nodeScan,
			mock<NetworkQuorumSetConfiguration>()
		);
		expect(result.isOk()).toBe(true);
	});

	it('should check if a newly found node is archived', async function () {
		nodeRepository.findByPublicKey.mockResolvedValue([
			Node.create(new Date(), newlyFoundPublicKey, {
				ip: 'localhost',
				port: 11625
			})
		]);
		const result = await crawlStep.execute(
			nodeScan,
			mock<NetworkQuorumSetConfiguration>()
		);
		expect(nodeRepository.findByPublicKey).toHaveBeenCalledWith([
			newlyFoundPublicKey
		]);
		expect(result.isOk()).toBe(true);
		if (!result.isOk()) return;
		expect(nodeScan.nodes).toHaveLength(2);
	});

	it('should not call node repository if no new nodes are found', async function () {
		crawlerService.crawl.mockResolvedValue(
			ok({
				latestClosedLedger: {
					sequence: BigInt(1),
					closeTime: new Date(),
					value: 'value',
					localCloseTime: new Date()
				},
				peerNodes: new Map([
					[activeNode.publicKey.value, new PeerNode(activeNode.publicKey.value)]
				]),
				processedLedgers: [1],
				scpStatementObservationCount: 0,
				scpStatementObservations: []
			})
		);
		await crawlStep.execute(nodeScan, mock<NetworkQuorumSetConfiguration>());
		expect(nodeRepository.findByPublicKey).not.toHaveBeenCalled();
	});

	it('should ignore invalid public-keys', async function () {
		crawlerService.crawl.mockResolvedValue(
			ok({
				latestClosedLedger: {
					sequence: BigInt(1),
					closeTime: new Date(),
					value: 'value',
					localCloseTime: new Date()
				},
				peerNodes: new Map([['malformed', new PeerNode('malformed')]]),
				processedLedgers: [1],
				scpStatementObservationCount: 0,
				scpStatementObservations: []
			})
		);
		const result = await crawlStep.execute(
			nodeScan,
			mock<NetworkQuorumSetConfiguration>()
		);
		expect(result.isOk()).toBe(true);
		expect(nodeRepository.findByPublicKey).not.toHaveBeenCalled();
	});

	it('should return error if crawl fails', async function () {
		crawlerService.crawl.mockResolvedValue(err(new Error('test')));
		const result = await crawlStep.execute(
			nodeScan,
			mock<NetworkQuorumSetConfiguration>()
		);
		expect(result.isErr()).toBe(true);
	});

	it('should return error if fetching archived nodes fails', async function () {
		nodeRepository.findByPublicKey.mockRejectedValue(new Error('test'));
		const result = await crawlStep.execute(
			nodeScan,
			mock<NetworkQuorumSetConfiguration>()
		);
		expect(result.isErr()).toBe(true);
	});

	it('persists crawl observations without a duplicate live projection callback', async () => {
		const observation = createObservation();
		nodeRepository.findByPublicKey.mockResolvedValue([]);
		crawlerService.crawl.mockResolvedValue(
			ok({
				latestClosedLedger: {
					sequence: 1n,
					closeTime: new Date(),
					value: 'value',
					localCloseTime: new Date()
				},
				peerNodes: new Map(),
				processedLedgers: [1],
				scpStatementObservationCount: 1,
				scpStatementObservations: [observation]
			})
		);

		const result = await crawlStep.execute(
			nodeScan,
			mock<NetworkQuorumSetConfiguration>()
		);

		expect(result.isOk()).toBe(true);
		expect(scpStatementObservationRepository.saveMany).toHaveBeenCalledWith(
			[observation],
			'network_scan'
		);
		expect(crawlerService.crawl.mock.calls.at(-1)?.[5]).toBeUndefined();
	});
});

function createObservation(): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-10T12:00:00.000Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex: '1',
		statementHash: 'statement-hash',
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: []
	};
}
