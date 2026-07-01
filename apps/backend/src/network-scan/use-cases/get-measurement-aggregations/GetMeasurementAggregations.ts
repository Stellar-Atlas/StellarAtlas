import { err, ok, Result } from 'neverthrow';
import { mapUnknownToError } from '../../../core/utilities/mapUnknownToError.js';
import { inject, injectable } from 'inversify';
import type { ExceptionLogger } from '../../../core/services/ExceptionLogger.js';
import 'reflect-metadata';
import { NetworkId } from '../../domain/network/NetworkId.js';
import { MeasurementAggregation } from '../../domain/measurement-aggregation/MeasurementAggregation.js';
import {
	AggregationTarget,
	GetMeasurementAggregationsDTO
} from './GetMeasurementAggregationsDTO.js';
import NetworkMeasurementDay from '../../domain/network/NetworkMeasurementDay.js';
import type { MeasurementAggregationRepository } from '../../domain/measurement-aggregation/MeasurementAggregationRepository.js';
import NetworkMeasurementMonth from '../../domain/network/NetworkMeasurementMonth.js';
import NodeMeasurementDay from '../../domain/node/NodeMeasurementDay.js';
import OrganizationMeasurementDay from '../../domain/organization/OrganizationMeasurementDay.js';
import { MeasurementAggregationRepositoryFactory } from '../../domain/measurement-aggregation/MeasurementAggregationRepositoryFactory.js';
import { MeasurementAggregationSourceId } from '../../domain/measurement-aggregation/MeasurementAggregationSourceId.js';
import PublicKey from '../../domain/node/PublicKey.js';
import { OrganizationId } from '../../domain/organization/OrganizationId.js';

@injectable()
export class GetMeasurementAggregations {
	constructor(
		private repoFactory: MeasurementAggregationRepositoryFactory,
		@inject('ExceptionLogger') protected exceptionLogger: ExceptionLogger
	) {}
	async execute(
		dto: GetMeasurementAggregationsDTO
	): Promise<Result<MeasurementAggregation[], Error>> {
		try {
			let repo:
				MeasurementAggregationRepository<MeasurementAggregation> | undefined;
			let idOrError: Result<MeasurementAggregationSourceId, Error> | undefined;

			switch (dto.aggregationTarget) {
				case AggregationTarget.NetworkDay:
					repo = this.repoFactory.createFor(NetworkMeasurementDay);
					idOrError = ok(new NetworkId(dto.id));
					break;
				case AggregationTarget.NetworkMonth:
					repo = this.repoFactory.createFor(NetworkMeasurementMonth);
					idOrError = ok(new NetworkId(dto.id));
					break;
				case AggregationTarget.NodeDay:
					repo = this.repoFactory.createFor(NodeMeasurementDay);
					idOrError = PublicKey.create(dto.id);
					break;
				case AggregationTarget.OrganizationDay:
					repo = this.repoFactory.createFor(OrganizationMeasurementDay);
					idOrError = OrganizationId.create(dto.id, dto.id);
					break;
			}

			if (idOrError.isErr()) {
				return err(idOrError.error);
			}

			return ok(await repo.findBetween(idOrError.value, dto.from, dto.to));
		} catch (error) {
			this.exceptionLogger.captureException(mapUnknownToError(error));
			return err(mapUnknownToError(error));
		}
	}
}
