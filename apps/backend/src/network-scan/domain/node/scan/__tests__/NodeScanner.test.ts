import { mock } from 'jest-mock-extended';
import type { Logger } from 'logger';
import { createDummyPublicKey } from '../../__fixtures__/createDummyPublicKey.js';
import { NodeScanner } from '../NodeScanner.js';
import { StellarCoreVersion } from '@network-scan/domain/network/StellarCoreVersion.js';
import { NetworkQuorumSetConfiguration } from '@network-scan/domain/network/NetworkQuorumSetConfiguration.js';
import { NodeScannerCrawlStep } from '../NodeScannerCrawlStep.js';
import { NodeScannerHomeDomainStep } from '../NodeScannerHomeDomainStep.js';
import { NodeScannerTomlStep } from '../NodeScannerTomlStep.js';
import { NodeScannerHistoryArchiveStep } from '../NodeScannerHistoryArchiveStep.js';
import { NodeScannerGeoStep } from '../NodeScannerGeoStep.js';
import { NodeScannerIndexerStep } from '../NodeScannerIndexerStep.js';
import { NodeScan } from '../NodeScan.js';
import { err, ok } from 'neverthrow';
import { NodeScannerArchivalStep } from '../NodeScannerArchivalStep.js';

it('should perform a network scan', async function () {
	const crawlerStep = mock<NodeScannerCrawlStep>();
	const homeDomainStep = mock<NodeScannerHomeDomainStep>();
	const tomlStep = mock<NodeScannerTomlStep>();
	const historyArchiveStep = mock<NodeScannerHistoryArchiveStep>();
	const geoStep = mock<NodeScannerGeoStep>();
	const indexerStep = mock<NodeScannerIndexerStep>();
	const archivalStep = mock<NodeScannerArchivalStep>();

	crawlerStep.execute.mockResolvedValue(ok(undefined));

	const nodeScanner = new NodeScanner(
		crawlerStep,
		homeDomainStep,
		tomlStep,
		historyArchiveStep,
		geoStep,
		indexerStep,
		archivalStep,
		mock<Logger>()
	);

	const stellarCoreVersionOrError = StellarCoreVersion.create('1.0.0');
	if (stellarCoreVersionOrError.isErr())
		throw new Error('StellarCoreVersion.create failed');

	const nodeScan = mock<NodeScan>();
	const quorumSetConfig = new NetworkQuorumSetConfiguration(1, [
		createDummyPublicKey()
	]);

	const result = await nodeScanner.execute(
		nodeScan,
		quorumSetConfig,
		stellarCoreVersionOrError.value,
		[],
		BigInt(1),
		new Date(),
		[]
	);

	expect(crawlerStep.execute).toHaveBeenCalledTimes(1);
	expect(homeDomainStep.execute).toHaveBeenCalledTimes(1);
	expect(tomlStep.execute).toHaveBeenCalledTimes(1);
	expect(historyArchiveStep.execute).toHaveBeenCalledTimes(1);
	expect(geoStep.execute).toHaveBeenCalledTimes(1);
	expect(indexerStep.execute).toHaveBeenCalledTimes(1);
	expect(archivalStep.execute).toHaveBeenCalledTimes(1);
	expect(nodeScan.updateStellarCoreVersionBehindStatus).toHaveBeenCalledTimes(
		1
	);

	expect(result.isOk()).toBe(true);
});

it('should return an error if the crawling fails', async function () {
	const crawlerStep = mock<NodeScannerCrawlStep>();
	const homeDomainStep = mock<NodeScannerHomeDomainStep>();
	const tomlStep = mock<NodeScannerTomlStep>();
	const historyArchiveStep = mock<NodeScannerHistoryArchiveStep>();
	const geoStep = mock<NodeScannerGeoStep>();
	const indexerStep = mock<NodeScannerIndexerStep>();
	const archivalStep = mock<NodeScannerArchivalStep>();

	crawlerStep.execute.mockResolvedValue(err(new Error('Crawling failed')));

	const nodeScanner = new NodeScanner(
		crawlerStep,
		homeDomainStep,
		tomlStep,
		historyArchiveStep,
		geoStep,
		indexerStep,
		archivalStep,
		mock<Logger>()
	);

	const stellarCoreVersionOrError = StellarCoreVersion.create('1.0.0');
	if (stellarCoreVersionOrError.isErr())
		throw new Error('StellarCoreVersion.create failed');

	const nodeScan = new NodeScan(new Date(), []);
	const quorumSetConfig = new NetworkQuorumSetConfiguration(1, [
		createDummyPublicKey()
	]);

	const result = await nodeScanner.execute(
		nodeScan,
		quorumSetConfig,
		stellarCoreVersionOrError.value,
		[],
		BigInt(1),
		new Date(),
		[]
	);

	expect(crawlerStep.execute).toHaveBeenCalledTimes(1);

	expect(result.isOk()).toBe(false);
});
