import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { ScpStatementObservationRepository } from '../../domain/scp/ScpStatementObservationRepository.js';
import type { GetScpStatementsDTO } from './GetScpStatementsDTO.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

@injectable()
export class GetScpStatements {
	constructor(
		@inject(NETWORK_TYPES.ScpStatementObservationRepository)
		private repository: ScpStatementObservationRepository
	) {}

	async execute(
		dto: GetScpStatementsDTO
	): Promise<Result<ScpStatementObservationV1[], Error>> {
		try {
			const observations = await this.repository.findLatest({
				limit: normalizeLimit(dto.limit),
				nodeId: dto.nodeId,
				slotIndex: dto.slotIndex
			});

			return ok(observations.map((observation) => observation.toDTO()));
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_LIMIT;
	if (!Number.isInteger(limit)) return DEFAULT_LIMIT;
	if (limit < 1) return DEFAULT_LIMIT;

	return Math.min(limit, MAX_LIMIT);
}
