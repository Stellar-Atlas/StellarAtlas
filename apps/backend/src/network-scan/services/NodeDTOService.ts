import Node from '../domain/node/Node.js';
import Organization from '../domain/organization/Organization.js';
import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '../../core/utilities/mapUnknownToError.js';
import type { NodeMeasurementRepository } from '../domain/node/NodeMeasurementRepository.js';
import type { NodeMeasurementDayRepository } from '../domain/node/NodeMeasurementDayRepository.js';
import { NETWORK_TYPES } from '../infrastructure/di/di-types.js';
import { inject, injectable } from 'inversify';
import { NodeV1DTOMapper } from '../mappers/NodeV1DTOMapper.js';
import { NodeV1 } from 'shared';
import type { NetworkScanRepository } from '../domain/network/scan/NetworkScanRepository.js';
import { NodeAvailabilityCache } from './NodeAvailabilityCache.js';

@injectable()
export class NodeDTOService {
	private readonly availability = new NodeAvailabilityCache();

	constructor(
		@inject(NETWORK_TYPES.NodeMeasurementRepository)
		private nodeMeasurementRepository: NodeMeasurementRepository,
		@inject(NETWORK_TYPES.NodeMeasurementDayRepository)
		private nodeMeasurementDayRepository: NodeMeasurementDayRepository,
		private nodeMapper: NodeV1DTOMapper,
		@inject(NETWORK_TYPES.NetworkScanRepository)
		private networkScanRepository: NetworkScanRepository
	) {}

	public async getCurrentNodeDTOs(
		time: Date,
		nodes: Node[],
		organizations: Organization[]
	): Promise<Result<NodeV1[], Error>> {
		try {
			// Known inventory routes have a response generation time, not a scan
			// timestamp. Resolve the small indexed watermark, never another inventory.
			const statisticsAt =
				await this.networkScanRepository.findLatestSuccessfulScanTime();
			return this.mapNodeDTOs(time, statisticsAt ?? null, nodes, organizations);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	public async getNodeDTOs(
		time: Date,
		nodes: Node[],
		organizations: Organization[]
	): Promise<Result<NodeV1[], Error>> {
		return this.mapNodeDTOs(time, time, nodes, organizations);
	}

	private async mapNodeDTOs(
		time: Date,
		statisticsAt: Date | null,
		nodes: Node[],
		organizations: Organization[]
	): Promise<Result<NodeV1[], Error>> {
		try {
			const nodesToOrganizations = new Map<string, string>();
			organizations.forEach((organization) => {
				organization.validators.value.forEach((node) => {
					nodesToOrganizations.set(
						node.value,
						organization.organizationId.value
					);
				});
			});

			const averages =
				statisticsAt === null
					? { day: [], month: [] }
					: await this.availability.get(statisticsAt, async () => ({
							day: await this.nodeMeasurementRepository.findXDaysAverageAt(
								statisticsAt,
								1
							),
							month: await this.nodeMeasurementDayRepository.findXDaysAverageAt(
								statisticsAt,
								30
							)
						}));

			const measurement24HourAveragesMap = new Map(
				averages.day.map((avg) => {
					return [avg.publicKey, avg];
				})
			);

			const measurement30DayAveragesMap = new Map(
				averages.month.map((avg) => {
					return [avg.publicKey, avg];
				})
			);

			return ok(
				nodes.map((node) => {
					return this.nodeMapper.toNodeV1DTO(
						time,
						node,
						measurement24HourAveragesMap.get(node.publicKey.value),
						measurement30DayAveragesMap.get(node.publicKey.value),
						nodesToOrganizations.get(node.publicKey.value)
					);
				})
			);
		} catch (e) {
			return err(mapUnknownToError(e));
		}
	}
}
