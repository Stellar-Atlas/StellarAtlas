import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { ScpStatementObservationRepository } from '../../domain/scp/ScpStatementObservationRepository.js';
import type {
	GetScpStatementsDTO,
	ScpStatementSource
} from './GetScpStatementsDTO.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	ScpStatementLiveCursor,
	ScpStatementLiveOrder,
	ScpStatementLiveStore
} from '../../domain/scp/ScpStatementLiveStore.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_SOURCE: ScpStatementSource = 'live';

@injectable()
export class GetScpStatements {
	constructor(
		@inject(NETWORK_TYPES.ScpStatementObservationRepository)
		private repository: ScpStatementObservationRepository,
		@inject(NETWORK_TYPES.ScpStatementLiveStore)
		private liveStore: ScpStatementLiveStore
	) {}

	async execute(
		dto: GetScpStatementsDTO
	): Promise<Result<ScpStatementObservationV1[], Error>> {
		try {
			const repositoryFilter = {
				limit: normalizeLimit(dto.limit),
				nodeId: dto.nodeId,
				slotIndex: dto.slotIndex
			};
			const source = normalizeSource(dto.source);
			if (source === 'stored') {
				const observations = await this.repository.findLatest(repositoryFilter);
				return ok(observations.map((observation) => observation.toDTO()));
			}

			const liveObservations = await this.liveStore.findLatest({
				...repositoryFilter,
				after: normalizeCursor(dto.after),
				order: normalizeOrder(dto.order)
			});
			if (liveObservations !== null) return ok(liveObservations);
			if (source === 'live') return ok([]);

			const observations = await this.repository.findLatest(repositoryFilter);
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

function normalizeCursor(
	cursor: ScpStatementLiveCursor | undefined
): ScpStatementLiveCursor | undefined {
	if (cursor === undefined) return undefined;
	if (!Number.isSafeInteger(cursor.observedAtMs)) return undefined;
	if (cursor.observedAtMs < 0) return undefined;
	if (cursor.statementHash.trim().length === 0) return undefined;

	return cursor;
}

function normalizeOrder(
	order: ScpStatementLiveOrder | undefined
): ScpStatementLiveOrder {
	return order === 'asc' ? 'asc' : 'desc';
}

function normalizeSource(
	source: ScpStatementSource | undefined
): ScpStatementSource {
	if (source === 'auto' || source === 'stored') return source;
	return DEFAULT_SOURCE;
}
