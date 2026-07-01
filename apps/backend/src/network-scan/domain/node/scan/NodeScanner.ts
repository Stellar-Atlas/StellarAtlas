import { inject, injectable } from 'inversify';
import type { Logger } from '../../../../core/services/Logger.js';
import { err, ok, Result } from 'neverthrow';
import { NetworkQuorumSetConfiguration } from '../../network/NetworkQuorumSetConfiguration.js';
import { StellarCoreVersion } from '../../network/StellarCoreVersion.js';
import { NodeMeasurementAverage } from '../NodeMeasurementAverage.js';
import { NodeScan } from './NodeScan.js';
import { NodeScannerCrawlStep } from './NodeScannerCrawlStep.js';
import { NodeScannerHomeDomainStep } from './NodeScannerHomeDomainStep.js';
import { NodeScannerTomlStep } from './NodeScannerTomlStep.js';
import { NodeScannerHistoryArchiveStep } from './NodeScannerHistoryArchiveStep.js';
import { NodeScannerGeoStep } from './NodeScannerGeoStep.js';
import { NodeScannerIndexerStep } from './NodeScannerIndexerStep.js';
import type { NodeAddress } from '../NodeAddress.js';
import { InactiveNodesArchiver } from '../archival/InactiveNodesArchiver.js';
import { TrustGraphFactory } from './TrustGraphFactory.js';
import { NodeScannerArchivalStep } from './NodeScannerArchivalStep.js';
import { SemanticVersionComparer } from 'shared';

@injectable()
export class NodeScanner {
	constructor(
		private crawlerStep: NodeScannerCrawlStep,
		private homeDomainStep: NodeScannerHomeDomainStep,
		private tomlStep: NodeScannerTomlStep,
		private historyArchiveStep: NodeScannerHistoryArchiveStep,
		private geoStep: NodeScannerGeoStep,
		private indexerStep: NodeScannerIndexerStep,
		private archivalStep: NodeScannerArchivalStep,
		@inject('Logger')
		private logger: Logger
	) {}

	public async execute(
		nodeScan: NodeScan,
		networkQuorumSetConfiguration: NetworkQuorumSetConfiguration,
		stellarCoreVersion: StellarCoreVersion,
		measurement30DayAverages: NodeMeasurementAverage[],
		previousLatestLedger: bigint | null,
		previousLatestLedgerCloseTime: Date | null,
		bootstrapNodeAddresses: NodeAddress[]
	): Promise<Result<NodeScan, Error>> {
		this.logger.info('Starting new node-scan with crawl');
		const nodeScanOrError = await this.crawlerStep.execute(
			nodeScan,
			networkQuorumSetConfiguration,
			previousLatestLedger,
			previousLatestLedgerCloseTime,
			bootstrapNodeAddresses
		);
		if (nodeScanOrError.isErr()) {
			return err(nodeScanOrError.error);
		}

		this.logger.info('Updating home domains');
		await this.homeDomainStep.execute(nodeScan);

		this.logger.info('updating node-details from TOML');
		await this.tomlStep.execute(nodeScan);

		this.logger.info('Updating history archive status');
		await this.historyArchiveStep.execute(nodeScan);

		this.logger.info('Updating geo data');
		await this.geoStep.execute(nodeScan);

		this.logger.info('Stellar core version check');
		nodeScan.updateStellarCoreVersionBehindStatus(stellarCoreVersion);

		this.logger.info('calculating indexes');
		this.indexerStep.execute(
			nodeScan,
			measurement30DayAverages,
			stellarCoreVersion
		);

		this.logger.info('archiving inactive nodes');
		await this.archivalStep.execute(nodeScan);

		return ok(nodeScan);
	}
}
