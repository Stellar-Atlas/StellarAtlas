import { err, ok, Result } from 'neverthrow';
import { inject, injectable } from 'inversify';
import type { HeartBeater } from '../../../core/services/HeartBeater.js';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import type { Logger } from '../../../core/services/Logger.js';
import type { Archiver } from '../../domain/network/scan/archiver/Archiver.js';
import { Notify } from '../../../notifications/use-cases/determine-events-and-notify-subscribers/Notify.js';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { NetworkConfig } from '../../../core/config/Config.js';
import { ScanNetworkDTO } from './ScanNetworkDTO.js';
import { UpdateNetwork } from '../update-network/UpdateNetwork.js';
import { UpdateNetworkDTO } from '../update-network/UpdateNetworkDTO.js';
import type { NetworkRepository } from '../../domain/network/NetworkRepository.js';
import { NetworkId } from '../../domain/network/NetworkId.js';
import type { NodeMeasurementDayRepository } from '../../domain/node/NodeMeasurementDayRepository.js';
import { Scanner, ScanResult } from '../../domain/Scanner.js';
import { ScanRepository } from '../../domain/ScanRepository.js';
import type { NodeAddress } from '../../domain/node/NodeAddress.js';
import { InvalidKnownPeersError } from './InvalidKnownPeersError.js';
import { Network } from '../../domain/network/Network.js';
import { NodeMeasurementAverage } from '../../domain/node/NodeMeasurementAverage.js';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';
import { NodeAddressMapper } from './NodeAddressMapper.js';
import { CORE_TYPES } from '../../../core/infrastructure/di/di-types.js';
import type { JobMonitor } from 'job-monitor';

interface ShutDownRequest {
	callback: () => void;
}
@injectable()
export class ScanNetwork {
	protected shutdownRequest?: ShutDownRequest;
	private isPersisting = false;

	constructor(
		@inject(NETWORK_TYPES.NetworkConfig)
		private networkConfig: NetworkConfig,
		@inject(UpdateNetwork)
		private updateNetworkUseCase: UpdateNetwork,
		@inject(NETWORK_TYPES.NetworkRepository)
		private networkRepository: NetworkRepository,
		@inject(NETWORK_TYPES.NodeMeasurementDayRepository)
		protected nodeMeasurementDayRepository: NodeMeasurementDayRepository,
		@inject(ScanRepository)
		private scanRepository: ScanRepository,
		@inject(Scanner)
		protected scanner: Scanner,
		@inject('JSONArchiver') protected jsonArchiver: Archiver,
		@inject('HeartBeater') protected heartBeater: HeartBeater,
		@inject(Notify)
		protected notify: Notify,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger,
		@inject('Logger') protected logger: Logger,
		@inject(CORE_TYPES.JobMonitor) protected jobMonitor: JobMonitor
	) {}

	async execute(dto: ScanNetworkDTO): Promise<Result<undefined, Error>> {
		try {
			await this.checkIn('in_progress');
			if (dto.updateNetwork) {
				const updateNetworkResult = await this.updateNetwork(
					this.networkConfig
				);
				if (updateNetworkResult.isErr()) {
					this.exceptionLogger.captureException(updateNetworkResult.error);
					await this.checkIn('error');
					return err(updateNetworkResult.error);
				}
			}

			const networkId = new NetworkId(this.networkConfig.networkId);
			const result = await this.executeScan(
				networkId,
				this.networkConfig.knownPeers,
				dto.dryRun
			);
			if (result.isErr()) {
				this.exceptionLogger.captureException(result.error);
				await this.checkIn('error');
			} //todo: the caller should determine what the 'fatal' errors are

			await this.checkIn('ok');
			return ok(undefined);
		} catch (error) {
			this.exceptionLogger.captureException(mapUnknownToError(error));
			await this.checkIn('error');
			return err(mapUnknownToError(error));
		}
	}

	private async checkIn(status: 'in_progress' | 'error' | 'ok') {
		const result = await this.jobMonitor.checkIn({
			context: 'scan-network',
			status
		});

		if (result.isErr()) {
			this.exceptionLogger.captureException(result.error);
		}
	}

	protected async executeScan(
		networkId: NetworkId,
		knownPeers: [string, number][],
		dryRun: boolean
	): Promise<Result<void, Error>> {
		const scanResult = await this.scanNetwork(networkId, knownPeers);
		if (scanResult.isErr()) {
			return err(scanResult.error);
		}

		return await this.persistScanResultAndNotify(scanResult.value, dryRun);
	}

	private async persistScanResultAndNotify(
		scanResult: ScanResult,
		dryRun = true
	): Promise<Result<void, Error>> {
		if (dryRun) return ok(undefined);
		this.isPersisting = true;
		const persistResult =
			await this.persistScanResultAndNotifyInternal(scanResult);
		this.isPersisting = false;
		if (this.shutdownRequest) this.shutdownRequest.callback();

		return persistResult;
	}

	private async scanNetwork(
		networkId: NetworkId,
		knownPeers: [string, number][]
	): Promise<Result<ScanResult, Error>> {
		this.logger.info('Scanning network');
		const scanDataOrError = await this.getScanData(networkId, knownPeers);
		if (scanDataOrError.isErr()) {
			return err(scanDataOrError.error);
		}

		return await this.scanner.scan(
			new Date(), //todo: inject?
			scanDataOrError.value.network,
			scanDataOrError.value.latestScanResult,
			scanDataOrError.value.nodeMeasurementAverages,
			scanDataOrError.value.bootstrapNodeAddresses
		);
	}

	protected async persistScanResultAndNotifyInternal(
		scanResult: ScanResult
	): Promise<Result<undefined, Error>> {
		this.logger.info('Persisting scan result');
		const result = await this.scanRepository.saveAndRollupMeasurements(
			scanResult.nodeScan,
			scanResult.organizationScan,
			scanResult.networkScan
		);
		if (result.isErr()) {
			return err(result.error);
		}

		await this.sendNotifications(scanResult);
		await this.archive(scanResult);
		await this.heartBeat();

		return ok(undefined);
	}

	private async sendNotifications(scanResult: ScanResult) {
		this.logger.info('notifications');
		(
			await this.notify.execute({
				networkUpdateTime: scanResult.networkScan.time
			})
		).mapErr((error) => this.exceptionLogger.captureException(error));
	}

	private async heartBeat() {
		this.logger.info('Trigger heartbeat');
		(await this.heartBeater.tick()).mapErr((e) =>
			this.exceptionLogger.captureException(e)
		);
	}

	private async archive(scanResult: ScanResult) {
		this.logger.info('JSON Archival');
		(await this.jsonArchiver.archive(scanResult.networkScan.time)).mapErr(
			(error) => this.exceptionLogger.captureException(error)
		);
	}

	private async updateNetwork(
		networkConfig: NetworkConfig
	): Promise<Result<void, Error>> {
		const updateNetworkDTO: UpdateNetworkDTO = {
			time: new Date(),
			name: networkConfig.networkName,
			networkId: networkConfig.networkId,
			passphrase: networkConfig.networkPassphrase,
			networkQuorumSet: networkConfig.quorumSet,
			overlayVersion: networkConfig.overlayVersion,
			overlayMinVersion: networkConfig.overlayMinVersion,
			ledgerVersion: networkConfig.ledgerVersion,
			stellarCoreVersion: networkConfig.stellarCoreVersion
		};

		return await this.updateNetworkUseCase.execute(updateNetworkDTO);
	}

	private async getScanData(
		networkId: NetworkId,
		knownPeers: [string, number][]
	): Promise<
		Result<
			{
				network: Network;
				bootstrapNodeAddresses: NodeAddress[];
				latestScanResult: ScanResult | null;
				nodeMeasurementAverages: NodeMeasurementAverage[];
			},
			Error
		>
	> {
		const networkOrError = await this.getNetwork(networkId);
		if (networkOrError.isErr()) return err(networkOrError.error);
		if (!networkOrError.value) {
			//todo: this is a fatal error
			return err(new Error(`Network with id ${networkId} not found`));
		}

		const knownNodeAddressesOrError =
			NodeAddressMapper.mapToNodeAddresses(knownPeers);
		if (knownNodeAddressesOrError.isErr()) {
			//todo: this is a fatal error
			return err(new InvalidKnownPeersError(knownNodeAddressesOrError.error));
		}

		const latestScanResultOrError =
			await this.scanRepository.findScanDataForUpdate();
		if (latestScanResultOrError.isErr())
			return err(latestScanResultOrError.error);

		const nodeAveragesOrError = await this.getNodeMeasurementAverages(
			latestScanResultOrError.value
		);
		if (nodeAveragesOrError.isErr()) return err(nodeAveragesOrError.error);

		return ok({
			network: networkOrError.value,
			bootstrapNodeAddresses: knownNodeAddressesOrError.value,
			latestScanResult: latestScanResultOrError.value,
			nodeMeasurementAverages: nodeAveragesOrError.value
		});
	}

	private async getNodeMeasurementAverages(
		scanResult: ScanResult | null
	): Promise<Result<NodeMeasurementAverage[], Error>> {
		try {
			const nodeMeasurementAverages =
				scanResult !== null
					? await this.nodeMeasurementDayRepository.findXDaysAverageAt(
							scanResult.nodeScan.time,
							30
						)
					: [];
			return ok(nodeMeasurementAverages);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	private async getNetwork(
		networkId: NetworkId
	): Promise<Result<Network | null, Error>> {
		try {
			const network =
				await this.networkRepository.findActiveByNetworkId(networkId);
			if (!network) return ok(null);
			return ok(network);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	public shutDown(callback: () => void) {
		if (!this.isPersisting) return callback();
		this.logger.info('Persisting update, will shutdown when ready');
		this.shutdownRequest = { callback: callback };
	}
}
