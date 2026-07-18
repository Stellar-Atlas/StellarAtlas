import { mock } from 'jest-mock-extended';
import { ok, type Result } from 'neverthrow';
import type { Logger } from '@core/services/Logger.js';
import { ConfigMock } from '@core/config/__mocks__/configMock.js';
import { createDummyNetworkProps } from '@network-scan/domain/network/__fixtures__/createDummyNetworkProps.js';
import { Network } from '@network-scan/domain/network/Network.js';
import { NetworkId } from '@network-scan/domain/network/NetworkId.js';
import type { NetworkRepository } from '@network-scan/domain/network/NetworkRepository.js';
import { NodeScan } from '@network-scan/domain/node/scan/NodeScan.js';
import {
	CrawlerService,
	type CrawlResult
} from '@network-scan/domain/node/scan/node-crawl/CrawlerService.js';
import { OrganizationScan } from '@network-scan/domain/organization/scan/OrganizationScan.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import type { ScanResult } from '@network-scan/domain/Scanner.js';
import type { ScanRepository } from '@network-scan/domain/ScanRepository.js';
import type { ScpStatementLiveStore } from '@network-scan/domain/scp/ScpStatementLiveStore.js';
import type { ScpStatementObservationRepository } from '@network-scan/domain/scp/ScpStatementObservationRepository.js';
import { scpStatementObservationPolicy } from '@network-scan/domain/scp/ScpStatementObservationPolicy.js';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { CollectScpLive } from '../CollectScpLive.js';

describe('CollectScpLive', () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it('projects a durable streamed observation only through the canonical tail', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const sut = setupSUT();
		const observation = createObservation('11');
		const crawl = deferred<Result<CrawlResult, Error>>();
		const emitted = deferred<void>();
		const postgres = deferred<CrawlerScpStatementObservation[]>();
		sut.observationRepository.saveMany.mockReturnValue(postgres.promise);
		sut.observationRepository.findProjectionEventPage
			.mockResolvedValueOnce({
				hasMore: false,
				nextAfterId: 0,
				observations: []
			})
			.mockResolvedValueOnce({
				hasMore: false,
				nextAfterId: 1,
				observations: [observation]
			});
		sut.crawlerService.crawl.mockImplementation(async (...args) => {
			const listener = args[5];
			void Promise.resolve(listener?.(observation)).catch(() => undefined);
			emitted.resolve(undefined);
			return crawl.promise;
		});

		let completed = false;
		const execution = sut.collectScpLive.execute().then((result) => {
			completed = true;
			return result;
		});
		await emitted.promise;
		jest.advanceTimersByTime(
			scpStatementObservationPolicy.persistenceFlushDelayMs
		);
		await flushMicrotasks();

		expect(sut.observationRepository.saveMany).toHaveBeenCalledWith(
			[observation],
			'scp_live_collector'
		);
		expect(sut.liveStore.saveMany).not.toHaveBeenCalled();
		expect(completed).toBe(false);

		postgres.resolve([observation]);
		await flushMicrotasks();
		expect(sut.liveStore.saveMany).not.toHaveBeenCalled();

		jest.advanceTimersByTime(
			scpStatementObservationPolicy.projectionEventTailPollIntervalMs
		);
		await flushMicrotasks();
		expect(sut.liveStore.saveMany).toHaveBeenCalledWith([observation]);
		expect(
			sut.observationRepository.saveMany.mock.invocationCallOrder[0]
		).toBeLessThan(sut.liveStore.saveMany.mock.invocationCallOrder[0]!);
		expect(completed).toBe(false);

		crawl.resolve(ok(createCrawlResult(11n, [11], 1)));
		const result = await execution;
		expect(result.isOk()).toBe(true);
		await sut.collectScpLive.shutDown(1_000);
	});

	it('does not project statements when canonical persistence fails', async () => {
		const sut = setupSUT();
		const observation = createObservation('11');
		sut.observationRepository.saveMany.mockRejectedValue(
			new Error('Postgres unavailable')
		);
		sut.crawlerService.crawl.mockImplementation(async (...args) => {
			void Promise.resolve(args[5]?.(observation)).catch(() => undefined);
			return ok(createCrawlResult(11n, [11], 1));
		});

		const result = await sut.collectScpLive.execute();
		await flushMicrotasks();

		expect(result.isErr()).toBe(true);
		expect(sut.liveStore.saveMany).not.toHaveBeenCalled();
	});

	it('requests a persistent crawler observation', async () => {
		const sut = setupSUT();
		sut.crawlerService.crawl.mockResolvedValue(
			ok(createCrawlResult(11n, [11], 0))
		);

		await sut.collectScpLive.execute();

		expect(sut.crawlerService.crawl.mock.calls[0]?.[6]).toEqual({
			keepObservationConnected: true
		});
	});

	it('drains retention backlog in bounded batches', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const sut = setupSUT();
		sut.crawlerService.crawl.mockResolvedValue(
			ok(createCrawlResult(11n, [11], 0))
		);
		sut.observationRepository.deleteOlderThan
			.mockResolvedValueOnce(scpStatementObservationPolicy.cleanupBatchSize)
			.mockResolvedValueOnce(scpStatementObservationPolicy.cleanupBatchSize)
			.mockResolvedValueOnce(7);

		const result = await sut.collectScpLive.execute();

		expect(result.isOk()).toBe(true);
		expect(sut.observationRepository.deleteOlderThan).toHaveBeenCalledTimes(3);
		expect(sut.logger.info).toHaveBeenCalledWith(
			'Deleted retained SCP statement observations',
			{ deleted: scpStatementObservationPolicy.cleanupBatchSize * 2 + 7 }
		);
	});

	it('caps each retention drain even when every batch is full', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const sut = setupSUT();
		sut.crawlerService.crawl.mockResolvedValue(
			ok(createCrawlResult(11n, [11], 0))
		);
		sut.observationRepository.deleteOlderThan.mockResolvedValue(
			scpStatementObservationPolicy.cleanupBatchSize
		);

		const result = await sut.collectScpLive.execute();

		expect(result.isOk()).toBe(true);
		expect(sut.observationRepository.deleteOlderThan).toHaveBeenCalledTimes(
			scpStatementObservationPolicy.maxCleanupBatchesPerRun
		);
	});

	it('keeps retention failure independent from canonical collection', async () => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-10T12:00:00.000Z'));
		const sut = setupSUT();
		sut.crawlerService.crawl.mockResolvedValue(
			ok(createCrawlResult(11n, [11], 0))
		);
		sut.observationRepository.deleteOlderThan.mockRejectedValue(
			new Error('cleanup failed')
		);

		const result = await sut.collectScpLive.execute();

		expect(result.isOk()).toBe(true);
		expect(sut.logger.error).toHaveBeenCalledWith(
			'Could not clean up retained SCP statements',
			{ errorMessage: 'cleanup failed' }
		);
	});

	it('continues the next crawl from the latest committed live ledger', async () => {
		const sut = setupSUT();
		sut.crawlerService.crawl
			.mockResolvedValueOnce(ok(createCrawlResult(11n, [10, 11], 0)))
			.mockResolvedValueOnce(ok(createCrawlResult(12n, [12], 0)));

		await sut.collectScpLive.execute();
		await sut.collectScpLive.execute();

		expect(sut.crawlerService.crawl.mock.calls[1]?.[3]).toBe(11n);
		expect(sut.crawlerService.crawl.mock.calls[1]?.[4]).toEqual(
			new Date('2026-07-03T00:00:11.000Z')
		);
	});

	it('does not skip live ledgers when the normal scanner advances', async () => {
		const sut = setupSUT();
		sut.crawlerService.crawl
			.mockResolvedValueOnce(ok(createCrawlResult(11n, [11], 0)))
			.mockResolvedValueOnce(ok(createCrawlResult(21n, [21], 0)));

		await sut.collectScpLive.execute();
		const scannerScan = createScanResult();
		scannerScan.networkScan.latestLedger = 20n;
		scannerScan.networkScan.latestLedgerCloseTime = new Date(
			'2026-07-03T00:00:20.000Z'
		);
		sut.scanRepository.findScanDataForUpdate.mockResolvedValue(ok(scannerScan));
		await sut.collectScpLive.execute();

		expect(sut.crawlerService.crawl.mock.calls[1]?.[3]).toBe(11n);
		expect(sut.crawlerService.crawl.mock.calls[1]?.[4]).toEqual(
			new Date('2026-07-03T00:00:11.000Z')
		);
	});

	it('does not report a successful shutdown while a canonical write is unresolved', async () => {
		jest.useFakeTimers();
		const sut = setupSUT();
		const observation = createObservation('11');
		sut.observationRepository.saveMany.mockReturnValue(new Promise(() => {}));
		sut.crawlerService.crawl.mockImplementation(async (...args) => {
			void Promise.resolve(args[5]?.(observation)).catch(() => undefined);
			return ok(createCrawlResult(11n, [11], 1));
		});

		const execution = sut.collectScpLive.execute();
		await flushMicrotasks();
		jest.advanceTimersByTime(
			scpStatementObservationPolicy.persistenceFlushDelayMs
		);
		await flushMicrotasks();
		const shutdown = sut.collectScpLive.shutDown(20_000);
		jest.advanceTimersByTime(
			scpStatementObservationPolicy.persistenceSaveTimeoutMs
		);
		await flushMicrotasks();

		await expect(shutdown).resolves.toEqual({
			canonicalDrained: false,
			projectionDrained: false
		});
		const executionResult = await execution;
		expect(executionResult.isErr()).toBe(true);
		expect(sut.liveStore.saveMany).not.toHaveBeenCalled();
	});

	it('owns and drains the active persistence buffer and projector on shutdown', async () => {
		const sut = setupSUT();
		const observation = createObservation('11');
		let onObservation:
			| ((observation: CrawlerScpStatementObservation) => Promise<void> | void)
			| undefined;
		const postgres = deferred<CrawlerScpStatementObservation[]>();
		const crawl = deferred<Result<CrawlResult, Error>>();
		sut.observationRepository.saveMany.mockReturnValue(postgres.promise);
		sut.crawlerService.crawl.mockImplementation(async (...args) => {
			onObservation = args[5];
			void Promise.resolve(onObservation?.(observation)).catch(() => undefined);
			return crawl.promise;
		});

		const execution = sut.collectScpLive.execute();
		await waitFor(
			() => sut.observationRepository.saveMany.mock.calls.length === 1
		);
		const shutdown = sut.collectScpLive.shutDown(5_000);
		expect(sut.crawlerService.stop).toHaveBeenCalledTimes(1);
		expect(onObservation?.(createObservation('12'))).toBeUndefined();
		let shutdownSettled = false;
		void shutdown.then(() => {
			shutdownSettled = true;
		});
		await flushMicrotasks();
		expect(shutdownSettled).toBe(false);

		postgres.resolve([observation]);
		crawl.resolve(ok(createCrawlResult(11n, [11], 1)));
		await expect(shutdown).resolves.toEqual({
			canonicalDrained: true,
			projectionDrained: true
		});
		await execution;
		expect(sut.observationRepository.saveMany).toHaveBeenCalledTimes(1);
		expect(sut.liveStore.saveMany).not.toHaveBeenCalled();
	});
});

function setupSUT() {
	const config = new ConfigMock();
	config.networkConfig.knownPeers = [['127.0.0.1', 11625]];
	const networkRepository = mock<NetworkRepository>();
	const scanRepository = mock<ScanRepository>();
	const crawlerService = mock<CrawlerService>();
	crawlerService.stop.mockResolvedValue(undefined);
	const observationRepository = mock<ScpStatementObservationRepository>();
	const liveStore = mock<ScpStatementLiveStore>();
	const logger = mock<Logger>();
	networkRepository.findActiveByNetworkId.mockResolvedValue(createNetwork());
	scanRepository.findScanDataForUpdate.mockResolvedValue(
		ok(createScanResult())
	);
	observationRepository.saveMany.mockImplementation(async (observations) => [
		...observations
	]);
	observationRepository.deleteOlderThan.mockResolvedValue(0);
	observationRepository.deleteProjectionEventsOlderThan.mockResolvedValue(0);
	observationRepository.findProjectionEventPage.mockResolvedValue({
		hasMore: false,
		nextAfterId: 0,
		observations: []
	});
	observationRepository.findProjectionPage.mockResolvedValue({
		nextAfterId: null,
		observations: []
	});
	liveStore.saveMany.mockResolvedValue({ status: 'accepted' });

	return {
		collectScpLive: new CollectScpLive(
			config.networkConfig,
			networkRepository,
			scanRepository,
			crawlerService,
			observationRepository,
			liveStore,
			logger
		),
		crawlerService,
		liveStore,
		logger,
		observationRepository,
		scanRepository
	};
}

function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
	for (let iteration = 0; iteration < 12; iteration += 1) {
		await Promise.resolve();
	}
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let iteration = 0; iteration < 100; iteration += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error('Condition did not become true');
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
	scpStatementObservationCount: number
): CrawlResult {
	return {
		latestClosedLedger: {
			closeTime: new Date(`2026-07-03T00:00:${latestLedger}.000Z`),
			localCloseTime: new Date(`2026-07-03T00:00:${latestLedger}.100Z`),
			sequence: latestLedger,
			value: `value-${latestLedger}`
		},
		peerNodes: new Map(),
		processedLedgers,
		scpStatementObservationCount,
		scpStatementObservations: []
	};
}

function createObservation(slotIndex: string): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date('2026-07-03T00:00:11.250Z'),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex,
		statementHash: `statement-${slotIndex}`,
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: []
	};
}
