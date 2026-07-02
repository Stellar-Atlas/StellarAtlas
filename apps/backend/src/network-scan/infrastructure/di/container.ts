import { interfaces } from 'inversify';
import Container = interfaces.Container;
import { GetNetwork } from '../../use-cases/get-network/GetNetwork.js';
import { GetLatestNodeSnapshots } from '../../use-cases/get-latest-node-snapshots/GetLatestNodeSnapshots.js';
import { GetLatestOrganizationSnapshots } from '../../use-cases/get-latest-organization-snapshots/GetLatestOrganizationSnapshots.js';
import { GetNodes } from '../../use-cases/get-nodes/GetNodes.js';
import { GetNode } from '../../use-cases/get-node/GetNode.js';
import { GetNodeSnapshots } from '../../use-cases/get-node-snapshots/GetNodeSnapshots.js';
import { GetOrganization } from '../../use-cases/get-organization/GetOrganization.js';
import { GetOrganizations } from '../../use-cases/get-organizations/GetOrganizations.js';
import { GetOrganizationSnapshots } from '../../use-cases/get-organization-snapshots/GetOrganizationSnapshots.js';
import { GetMeasurements } from '../../use-cases/get-measurements/GetMeasurements.js';
import { GetMeasurementsFactory } from '../../use-cases/get-measurements/GetMeasurementsFactory.js';
import { DataSource, Repository } from 'typeorm';
import { HistoryScanCoordinatorScanService } from '../services/HistoryScanCoordinatorScanService.js';
import type { HistoryArchiveScanService } from '../../domain/node/scan/history/HistoryArchiveScanService.js';
import { NETWORK_TYPES } from './di-types.js';
import type { NodeMeasurementRepository } from '../../domain/node/NodeMeasurementRepository.js';
import type { NetworkRepository } from '../../domain/network/NetworkRepository.js';
import { TypeOrmOrganizationMeasurementRepository } from '../database/repositories/TypeOrmOrganizationMeasurementRepository.js';
import type { OrganizationMeasurementRepository } from '../../domain/organization/OrganizationMeasurementRepository.js';
import { TypeOrmNodeMeasurementRepository } from '../database/repositories/TypeOrmNodeMeasurementRepository.js';
import type { NetworkMeasurementRepository } from '../../domain/network/NetworkMeasurementRepository.js';
import { TypeOrmNetworkMeasurementRepository } from '../database/repositories/TypeOrmNetworkMeasurementRepository.js';
import { TypeOrmNetworkRepository } from '../database/repositories/TypeOrmNetworkRepository.js';
import DatabaseMeasurementsRollupService from '../services/DatabaseMeasurementsRollupService.js';
import type { MeasurementsRollupService } from '../../domain/measurement-aggregation/MeasurementsRollupService.js';
import MeasurementRollup from '../database/entities/MeasurementRollup.js';
import TypeOrmNodeSnapShotRepository from '../database/repositories/TypeOrmNodeSnapShotRepository.js';
import type { NodeSnapShotRepository } from '../../domain/node/NodeSnapShotRepository.js';
import { TypeOrmNodeMeasurementDayRepository } from '../database/repositories/TypeOrmNodeMeasurementDayRepository.js';
import type { NodeMeasurementDayRepository } from '../../domain/node/NodeMeasurementDayRepository.js';
import type { OrganizationMeasurementDayRepository } from '../../domain/organization/OrganizationMeasurementDayRepository.js';
import { TypeOrmOrganizationMeasurementDayRepository } from '../database/repositories/TypeOrmOrganizationMeasurementDayRepository.js';
import { TypeOrmNetworkScanRepository } from '../database/repositories/TypeOrmNetworkScanRepository.js';
import type { NetworkScanRepository } from '../../domain/network/scan/NetworkScanRepository.js';
import type { NetworkMeasurementDayRepository } from '../../domain/network/NetworkMeasurementDayRepository.js';
import { TypeOrmNetworkMeasurementDayRepository } from '../database/repositories/TypeOrmNetworkMeasurementDayRepository.js';
import type { NetworkMeasurementMonthRepository } from '../../domain/network/NetworkMeasurementMonthRepository.js';
import { TypeOrmNetworkMeasurementMonthRepository } from '../database/repositories/TypeOrmNetworkMeasurementMonthRepository.js';
import type { OrganizationRepository } from '../../domain/organization/OrganizationRepository.js';
import { TypeOrmOrganizationRepository } from '../database/repositories/TypeOrmOrganizationRepository.js';
import { GetMeasurementAggregations } from '../../use-cases/get-measurement-aggregations/GetMeasurementAggregations.js';
import { MeasurementAggregationRepositoryFactory } from '../../domain/measurement-aggregation/MeasurementAggregationRepositoryFactory.js';
import { Config } from '../../../core/config/Config.js';
import type { NetworkConfig } from '../../../core/config/Config.js';
import { NetworkDTOService } from '../../services/NetworkDTOService.js';
import { HomeDomainFetcher } from '../../domain/node/scan/HomeDomainFetcher.js';
import { TomlService } from '../../domain/network/scan/TomlService.js';
import type { GeoDataService } from '../../domain/node/scan/GeoDataService.js';
import { HistoryArchiveStatusFinder } from '../../domain/node/scan/HistoryArchiveStatusFinder.js';
import type { Archiver } from '../../domain/network/scan/archiver/Archiver.js';
import type { Logger } from '../../../core/services/Logger.js';
import { HistoryService } from '../../domain/node/scan/history/HistoryService.js';
import { IpStackGeoDataService } from '../services/IpStackGeoDataService.js';
import { IpWhoIsGeoDataService } from '../services/IpWhoIsGeoDataService.js';
import { FallbackGeoDataService } from '../services/FallbackGeoDataService.js';
import type { HttpService } from 'http-helper';
import { NetworkScanner } from '../../domain/network/scan/NetworkScanner.js';
import { CrawlerService } from '../../domain/node/scan/node-crawl/CrawlerService.js';
import { createCrawler, createCrawlFactory } from 'crawler';
import FbasAnalyzerFacade from '../../domain/network/scan/fbas-analysis/FbasAnalyzerFacade.js';
import { HorizonService } from '../../domain/network/scan/HorizonService.js';
import OrganizationMeasurement from '../../domain/organization/OrganizationMeasurement.js';
import NetworkMeasurement from '../../domain/network/NetworkMeasurement.js';
import NodeGeoDataLocation from '../../domain/node/NodeGeoDataLocation.js';
import NodeQuorumSet from '../../domain/node/NodeQuorumSet.js';
import { ScanNetwork } from '../../use-cases/scan-network/ScanNetwork.js';
import { UpdateNetwork } from '../../use-cases/update-network/UpdateNetwork.js';
import type { NodeRepository } from '../../domain/node/NodeRepository.js';
import { TypeOrmNodeRepository } from '../database/repositories/TypeOrmNodeRepository.js';
import { Network } from '../../domain/network/Network.js';
import { NodeScanner } from '../../domain/node/scan/NodeScanner.js';
import { OrganizationScanner } from '../../domain/organization/scan/OrganizationScanner.js';
import Node from '../../domain/node/Node.js';
import NodeSnapShot from '../../domain/node/NodeSnapShot.js';
import { NodeScannerIndexerStep } from '../../domain/node/scan/NodeScannerIndexerStep.js';
import { NodeScannerHistoryArchiveStep } from '../../domain/node/scan/NodeScannerHistoryArchiveStep.js';
import { NodeScannerHomeDomainStep } from '../../domain/node/scan/NodeScannerHomeDomainStep.js';
import { NodeScannerGeoStep } from '../../domain/node/scan/NodeScannerGeoStep.js';
import { NodeScannerCrawlStep } from '../../domain/node/scan/NodeScannerCrawlStep.js';
import { NodeScannerTomlStep } from '../../domain/node/scan/NodeScannerTomlStep.js';
import { NodeTomlFetcher } from '../../domain/node/scan/NodeTomlFetcher.js';
import Organization from '../../domain/organization/Organization.js';
import { OrganizationTomlFetcher } from '../../domain/organization/scan/OrganizationTomlFetcher.js';
import { Scanner } from '../../domain/Scanner.js';
import type { OrganizationSnapShotRepository } from '../../domain/organization/OrganizationSnapShotRepository.js';
import TypeOrmOrganizationSnapShotRepository from '../database/repositories/TypeOrmOrganizationSnapShotRepository.js';
import OrganizationSnapShot from '../../domain/organization/OrganizationSnapShot.js';
import NetworkScan from '../../domain/network/scan/NetworkScan.js';
import { ScanRepository } from '../../domain/ScanRepository.js';
import { NodeDTOService } from '../../services/NodeDTOService.js';
import { OrganizationDTOService } from '../../services/OrganizationDTOService.js';
import { ScanNetworkLooped } from '../../use-cases/scan-network-looped/ScanNetworkLooped.js';
import { NullArchiver, S3Archiver } from '../services/S3Archiver.js';
import FbasAnalyzerService from '../../domain/network/scan/fbas-analysis/FbasAnalyzerService.js';
import { FbasMergedByAnalyzer } from '../../domain/network/scan/fbas-analysis/FbasMergedByAnalyzer.js';
import { NodesInTransitiveNetworkQuorumSetFinder } from '../../domain/network/scan/NodesInTransitiveNetworkQuorumSetFinder.js';
import { NodeV1DTOMapper } from '../../mappers/NodeV1DTOMapper.js';
import { OrganizationV1DTOMapper } from '../../mappers/OrganizationV1DTOMapper.js';
import { NetworkV1DTOMapper } from '../../mappers/NetworkV1DTOMapper.js';
import { ValidatorDemoter } from '../../domain/node/archival/ValidatorDemoter.js';
import { InactiveNodesArchiver } from '../../domain/node/archival/InactiveNodesArchiver.js';
import { NodeScannerArchivalStep } from '../../domain/node/scan/NodeScannerArchivalStep.js';
import NodeMeasurement from '../../domain/node/NodeMeasurement.js';
import NetworkMeasurementMonth from '../../domain/network/NetworkMeasurementMonth.js';
import OrganizationMeasurementDay from '../../domain/organization/OrganizationMeasurementDay.js';
import NodeMeasurementDay from '../../domain/node/NodeMeasurementDay.js';
import NetworkMeasurementDay from '../../domain/network/NetworkMeasurementDay.js';
import { CachedNetworkDTOService } from '../../services/CachedNetworkDTOService.js';
import { ScpStatementObservation } from '../../domain/scp/ScpStatementObservation.js';
import type { ScpStatementObservationRepository } from '../../domain/scp/ScpStatementObservationRepository.js';
import { TypeOrmScpStatementObservationRepository } from '../database/repositories/TypeOrmScpStatementObservationRepository.js';
import { GetScpStatements } from '../../use-cases/get-scp-statements/GetScpStatements.js';

export function load(container: Container, config: Config) {
	container
		.bind<string>(NETWORK_TYPES.networkId)
		.toConstantValue(config.networkConfig.networkId);
	container
		.bind<string>(NETWORK_TYPES.networkName)
		.toConstantValue(config.networkConfig.networkName);
	container
		.bind<NetworkConfig>(NETWORK_TYPES.NetworkConfig)
		.toConstantValue(config.networkConfig);

	loadDomain(container, config);
	loadUseCases(container);
	loadServices(container, config);
	loadMappers(container);
}

function loadRollup(container: Container) {
	const dataSource = container.get<DataSource>(DataSource);
	container
		.bind<Repository<MeasurementRollup>>('Repository<MeasurementRollup>')
		.toDynamicValue(() => {
			return dataSource.getRepository(MeasurementRollup);
		})
		.inRequestScope();
	container
		.bind<MeasurementsRollupService>(NETWORK_TYPES.MeasurementsRollupService)
		.to(DatabaseMeasurementsRollupService);

	container
		.bind<NodeMeasurementDayRepository>(
			NETWORK_TYPES.NodeMeasurementDayRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmNodeMeasurementDayRepository(
				dataSource.getRepository(NodeMeasurementDay)
			);
		})
		.inRequestScope();
	container
		.bind<OrganizationMeasurementDayRepository>(
			NETWORK_TYPES.OrganizationMeasurementDayRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmOrganizationMeasurementDayRepository(
				dataSource.getRepository(OrganizationMeasurementDay)
			);
		})
		.inRequestScope();

	container
		.bind<NetworkMeasurementDayRepository>(
			NETWORK_TYPES.NetworkMeasurementDayRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmNetworkMeasurementDayRepository(
				dataSource.getRepository(NetworkMeasurementDay)
			);
		})
		.inRequestScope();
	container
		.bind<NetworkMeasurementMonthRepository>(
			NETWORK_TYPES.NetworkMeasurementMonthRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmNetworkMeasurementMonthRepository(
				dataSource.getRepository(NetworkMeasurementMonth)
			);
		})
		.inRequestScope();
	container.bind(MeasurementAggregationRepositoryFactory).toSelf();
}

function loadServices(container: Container, config: Config) {
	container.bind(NetworkDTOService).toSelf();
	container.bind(NodeDTOService).toSelf();
	container.bind(OrganizationDTOService).toSelf();
	container.bind<Archiver>('JSONArchiver').toDynamicValue(() => {
		if (
			config.enableS3Backup &&
			config.s3Secret &&
			config.s3AccessKeyId &&
			config.s3BucketName &&
			config.s3Region
		)
			return new S3Archiver(
				config.s3AccessKeyId,
				config.s3Secret,
				config.s3BucketName,
				config.s3Region,
				config.nodeEnv,
				container.get(NetworkDTOService)
			);
		return new NullArchiver(container.get<Logger>('Logger'));
	});
	container.bind(CachedNetworkDTOService).toSelf();
}

function loadMappers(container: Container) {
	container.bind(NodeV1DTOMapper).toSelf();
	container.bind(OrganizationV1DTOMapper).toSelf();
	container.bind(NetworkV1DTOMapper).toSelf();
}

function loadDomain(container: Container, config: Config) {
	loadNodeScan(container);
	loadOrganizationScan(container);
	container.bind(Scanner).toSelf();
	container.bind(ScanRepository).toSelf();
	loadSnapshotting(container);
	loadRollup(container);
	const dataSource = container.get<DataSource>(DataSource);
	container
		.bind<Repository<OrganizationMeasurement>>(
			'Repository<OrganizationMeasurement>'
		)
		.toDynamicValue(() => {
			return dataSource.getRepository(OrganizationMeasurement);
		})
		.inRequestScope();
	container
		.bind<Repository<NetworkMeasurement>>('Repository<NetworkMeasurement>')
		.toDynamicValue(() => {
			return dataSource.getRepository(NetworkMeasurement);
		})
		.inRequestScope();
	container
		.bind<Repository<NodeGeoDataLocation>>('Repository<NodeGeoDataStorage>')
		.toDynamicValue(() => {
			return dataSource.getRepository(NodeGeoDataLocation);
		})
		.inRequestScope();
	container
		.bind<Repository<NodeQuorumSet>>('Repository<NodeQuorumSetStorage>')
		.toDynamicValue(() => {
			return dataSource.getRepository(NodeQuorumSet);
		})
		.inRequestScope();
	container.bind<CrawlerService>(CrawlerService).toDynamicValue(() => {
		const crawler = createCrawler(
			config.crawlerConfig,
			container.get<Logger>('Logger').getRawLogger()
		); //todo:dependencies should accept generic logger interface
		const crawlFactory = createCrawlFactory(
			config.crawlerConfig,
			container.get<Logger>('Logger').getRawLogger()
		);
		return new CrawlerService(crawler, crawlFactory);
	});

	container.bind<FbasAnalyzerService>(FbasAnalyzerService).toSelf();
	container.bind(FbasAnalyzerFacade).toSelf();
	container.bind(FbasMergedByAnalyzer).toSelf();
	container.bind(NodesInTransitiveNetworkQuorumSetFinder).toSelf();
	container.bind<HorizonService>(HorizonService).toDynamicValue(() => {
		return new HorizonService(
			container.get<HttpService>('HttpService'),
			config.horizonUrl
		);
	});
	container
		.bind<OrganizationMeasurementRepository>(
			NETWORK_TYPES.OrganizationMeasurementRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmOrganizationMeasurementRepository(
				dataSource.getRepository(OrganizationMeasurement)
			);
		})
		.inRequestScope();

	container
		.bind<NodeMeasurementRepository>(NETWORK_TYPES.NodeMeasurementRepository)
		.toDynamicValue(() => {
			return new TypeOrmNodeMeasurementRepository(
				dataSource.getRepository(NodeMeasurement)
			);
		})
		.inRequestScope();

	container
		.bind<NetworkMeasurementRepository>(
			NETWORK_TYPES.NetworkMeasurementRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmNetworkMeasurementRepository(
				dataSource.getRepository(NetworkMeasurement)
			);
		})
		.inRequestScope();
	container
		.bind<HistoryArchiveScanService>(NETWORK_TYPES.HistoryArchiveScanService)
		.to(HistoryScanCoordinatorScanService);
	container
		.bind<NetworkRepository>(NETWORK_TYPES.NetworkRepository)
		.toDynamicValue(() => {
			return new TypeOrmNetworkRepository(dataSource.getRepository(Network));
		});
	container
		.bind<NetworkScanRepository>(NETWORK_TYPES.NetworkScanRepository)
		.toDynamicValue(() => {
			return new TypeOrmNetworkScanRepository(
				dataSource.getRepository(NetworkScan)
			);
		})
		.inRequestScope();
	container
		.bind<ScpStatementObservationRepository>(
			NETWORK_TYPES.ScpStatementObservationRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmScpStatementObservationRepository(
				dataSource.getRepository(ScpStatementObservation)
			);
		})
		.inRequestScope();

	container.bind<HomeDomainFetcher>(HomeDomainFetcher).toSelf();
	container.bind<TomlService>(TomlService).toSelf().inSingletonScope();
	container.bind<HistoryService>(HistoryService).toSelf();
	container.bind<GeoDataService>('GeoDataService').toDynamicValue(() => {
		const httpService = container.get<HttpService>('HttpService');
		const logger = container.get<Logger>('Logger');
		return new FallbackGeoDataService(
			new IpStackGeoDataService(logger, httpService, config.ipStackAccessKey),
			new IpWhoIsGeoDataService(httpService),
			logger
		);
	});
	container
		.bind<HistoryArchiveStatusFinder>(HistoryArchiveStatusFinder)
		.toSelf();
	container.bind(NetworkScanner).toSelf();
	container.bind(NodeScanner).toSelf();
	container.bind(OrganizationScanner).toSelf();
}

function loadUseCases(container: Container) {
	container.bind(GetNetwork).toSelf();
	container.bind(GetLatestNodeSnapshots).toSelf();
	container.bind(GetLatestOrganizationSnapshots).toSelf();
	container.bind(GetNodes).toSelf();
	container.bind(GetNode).toSelf();
	container.bind(GetNodeSnapshots).toSelf();
	container.bind(GetOrganization).toSelf();
	container.bind(GetOrganizations).toSelf();
	container.bind(GetOrganizationSnapshots).toSelf();
	container.bind(GetMeasurements).toSelf();
	container.bind(GetMeasurementsFactory).toSelf();
	container.bind(GetMeasurementAggregations).toSelf();
	container.bind(GetScpStatements).toSelf();
	container.bind(UpdateNetwork).toSelf();
	container.bind(ScanNetworkLooped).toSelf();
	container.bind<ScanNetwork>(ScanNetwork).toSelf();
}

function loadNodeScan(container: Container) {
	container.bind(NodeTomlFetcher).toSelf();
	container.bind(NodeScannerTomlStep).toSelf();
	container.bind(NodeScannerIndexerStep).toSelf();
	container.bind(NodeScannerHistoryArchiveStep).toSelf();
	container.bind(NodeScannerHomeDomainStep).toSelf();
	container.bind(NodeScannerGeoStep).toSelf();
	container.bind(NodeScannerCrawlStep).toSelf();
	container.bind(NodeScannerArchivalStep).toSelf();
}

function loadOrganizationScan(container: Container) {
	container.bind(OrganizationTomlFetcher).toSelf();
}

function loadSnapshotting(container: Container) {
	const dataSource = container.get<DataSource>(DataSource);
	container
		.bind<NodeRepository>(NETWORK_TYPES.NodeRepository)
		.toDynamicValue(() => {
			return new TypeOrmNodeRepository(dataSource.getRepository(Node));
		})
		.inRequestScope();
	container
		.bind<OrganizationRepository>(NETWORK_TYPES.OrganizationRepository)
		.toDynamicValue(() => {
			return new TypeOrmOrganizationRepository(
				dataSource.getRepository(Organization)
			);
		})
		.inRequestScope();

	container
		.bind<NodeSnapShotRepository>(NETWORK_TYPES.NodeSnapshotRepository)
		.toDynamicValue(() => {
			return new TypeOrmNodeSnapShotRepository(
				dataSource.getRepository(NodeSnapShot)
			);
		})
		.inRequestScope();
	container
		.bind<OrganizationSnapShotRepository>(
			NETWORK_TYPES.OrganizationSnapshotRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmOrganizationSnapShotRepository(
				dataSource.getRepository(OrganizationSnapShot)
			);
		})
		.inRequestScope();
	container.bind<ValidatorDemoter>(ValidatorDemoter).toSelf();
	container.bind<InactiveNodesArchiver>(InactiveNodesArchiver).toSelf();
}
