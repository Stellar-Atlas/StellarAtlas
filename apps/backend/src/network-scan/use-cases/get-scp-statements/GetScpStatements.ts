import { inject, injectable } from 'inversify';
import { err, ok, Result } from 'neverthrow';
import type { ScpStatementObservationV1 } from 'shared';
import { NETWORK_TYPES } from '../../infrastructure/di/di-types.js';
import type { ScpStatementObservationRepository } from '../../domain/scp/ScpStatementObservationRepository.js';
import type {
	GetScpStatementsDTO,
	GetStoredScpStatementPageDTO,
	ScpStatementSource
} from './GetScpStatementsDTO.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type {
	ScpStatementLiveCursor,
	ScpStatementLiveOrder,
	ScpStatementLiveStore
} from '../../domain/scp/ScpStatementLiveStore.js';
import { scpStatementObservationPolicy } from '../../domain/scp/ScpStatementObservationPolicy.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_SOURCE: ScpStatementSource = 'live';
const DEFAULT_ANIMATION_EVENT_LIMIT = 251;
const MAX_ANIMATION_EVENT_LIMIT = 4_001;

export type ScpStatementReadSource = 'meilisearch' | 'postgres_canonical';
export type ScpStatementReadFreshness =
	'empty' | 'fresh' | 'stale' | 'unavailable';

export interface ScpStatementReadResult {
	freshness: ScpStatementReadFreshness;
	freshnessMs: number | null;
	observations: ScpStatementObservationV1[];
	observedAt: string | null;
	source: ScpStatementReadSource;
}

export interface ScpAnimationStatement {
	readonly nodeId: string;
	readonly observedAt: string;
	readonly observedFromPeer: string;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statementHash: string;
	readonly statementType: ScpStatementObservationV1['statementType'];
	readonly values: readonly {
		readonly closeTime: string;
		readonly txSetHash: string;
	}[];
}

export interface ScpAnimationReadResult {
	readonly freshness: ScpStatementReadFreshness;
	readonly freshnessMs: number | null;
	readonly observations: readonly ScpAnimationStatement[];
	readonly observedAt: string | null;
	readonly source: 'postgres_canonical';
}

export interface ScpStoredStatementPageReadResult extends ScpStatementReadResult {
	readonly page: {
		readonly hasMore: boolean;
		readonly limit: number;
		readonly nextCursor: ScpStatementLiveCursor | null;
	};
}

type ObservationRead =
	| { observations: ScpStatementObservationV1[]; status: 'available' }
	| { error: Error; status: 'unavailable' };

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
		const result = await this.executeWithMetadata(dto);
		return result.map(({ observations }) => observations);
	}

	async executeLatestAnimationSlots(
		limit: number,
		eventLimit = DEFAULT_ANIMATION_EVENT_LIMIT
	): Promise<Result<ScpAnimationReadResult, Error>> {
		try {
			const observations = (
				await this.repository.findLatestAnimationSlots(
					limit,
					normalizeAnimationEventLimit(eventLimit)
				)
			).map((observation) => ({
				nodeId: observation.nodeId,
				observedAt: observation.observedAt.toISOString(),
				observedFromPeer: observation.observedFromPeer,
				quorumSetHash: observation.quorumSetHash,
				slotIndex: observation.slotIndex,
				statementHash: observation.statementHash,
				statementType: observation.statementType,
				values: observation.values
			}));
			const metadata = toReadMetadata(observations, 'postgres_canonical');
			return ok({ ...metadata, observations, source: 'postgres_canonical' });
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeStoredPageWithMetadata(
		dto: GetStoredScpStatementPageDTO
	): Promise<Result<ScpStoredStatementPageReadResult, Error>> {
		try {
			const limit = normalizeLimit(dto.limit);
			const nodeIds = normalizeNodeIds(dto.nodeIds);
			const filter = {
				after: normalizeCursor(dto.after),
				limit: limit + 1,
				nodeId: dto.nodeId,
				nodeIds,
				order: normalizeOrder(dto.order),
				slotIndex: dto.slotIndex
			};
			const stored =
				nodeIds?.length === 0 ? [] : await this.repository.findLatest(filter);
			const hasMore = stored.length > limit;
			const observations = stored
				.slice(0, limit)
				.map((observation) => observation.toDTO());
			const result = toReadResult(observations, 'postgres_canonical');
			return ok({
				...result,
				page: {
					hasMore,
					limit,
					nextCursor: hasMore ? requireLastCursor(observations) : null
				}
			});
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}

	async executeWithMetadata(
		dto: GetScpStatementsDTO
	): Promise<Result<ScpStatementReadResult, Error>> {
		try {
			const repositoryFilter = {
				after: normalizeCursor(dto.after),
				limit: normalizeLimit(dto.limit),
				nodeId: dto.nodeId,
				order: normalizeOrder(dto.order),
				slotIndex: dto.slotIndex
			};
			const source = normalizeSource(dto.source);
			if (source === 'stored') {
				const observations = await this.repository.findLatest(repositoryFilter);
				return ok(
					toReadResult(
						observations.map((observation) => observation.toDTO()),
						'postgres_canonical'
					)
				);
			}

			const liveFilter = { ...repositoryFilter };
			if (source === 'live') {
				const observations = await this.liveStore.findLatest(liveFilter);
				return ok(
					observations === null
						? unavailableReadResult('meilisearch')
						: toReadResult(observations, 'meilisearch')
				);
			}

			const [live, canonical] = await Promise.all([
				readObservations(async () => {
					const observations = await this.liveStore.findLatest(liveFilter);
					if (observations === null) throw new Error('Meilisearch unavailable');
					return observations;
				}),
				readObservations(async () => {
					const observations =
						await this.repository.findLatest(repositoryFilter);
					return observations.map((observation) => observation.toDTO());
				})
			]);
			if (live.status === 'unavailable' && canonical.status === 'available') {
				return ok(toReadResult(canonical.observations, 'postgres_canonical'));
			}
			if (live.status === 'available' && canonical.status === 'unavailable') {
				return ok(toReadResult(live.observations, 'meilisearch'));
			}
			if (live.status === 'available' && canonical.status === 'available') {
				const liveResult = toReadResult(live.observations, 'meilisearch');
				const canonicalResult = toReadResult(
					canonical.observations,
					'postgres_canonical'
				);
				return ok(
					pagesEquivalent(
						liveResult.observations,
						canonicalResult.observations
					) && isMeilisearchSuitable(liveResult)
						? liveResult
						: canonicalResult
				);
			}
			return ok(unavailableReadResult('postgres_canonical'));
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

async function readObservations(
	read: () => Promise<ScpStatementObservationV1[]>
): Promise<ObservationRead> {
	try {
		return { observations: await read(), status: 'available' };
	} catch (error) {
		return { error: mapUnknownToError(error), status: 'unavailable' };
	}
}

function toReadResult(
	observations: ScpStatementObservationV1[],
	source: ScpStatementReadSource
): ScpStatementReadResult {
	const metadata = toReadMetadata(observations, source);
	return { ...metadata, observations, source };
}

function toReadMetadata(
	observations: readonly { readonly observedAt: string }[],
	source: ScpStatementReadSource
): Omit<ScpStatementReadResult, 'observations'> {
	if (observations.length === 0)
		return {
			freshness: 'empty',
			freshnessMs: null,
			observedAt: null,
			source
		};
	const observedTimes = observations.map((observation) =>
		Date.parse(observation.observedAt)
	);
	const validObservedTimes = observedTimes.filter(Number.isFinite);
	const observedAtMs =
		validObservedTimes.length === 0 ? null : Math.max(...validObservedTimes);
	if (observedAtMs === null) {
		return {
			freshness: 'stale',
			freshnessMs: null,
			observedAt: null,
			source
		};
	}
	const ageMs = Date.now() - observedAtMs;
	const hasInvalidObservedAt =
		validObservedTimes.length !== observations.length;
	return {
		freshness:
			!hasInvalidObservedAt &&
			ageMs >= -scpStatementObservationPolicy.readFutureToleranceMs &&
			ageMs <= scpStatementObservationPolicy.readFreshnessMs
				? 'fresh'
				: 'stale',
		freshnessMs: Math.abs(ageMs),
		observedAt: new Date(observedAtMs).toISOString(),
		source
	};
}

function unavailableReadResult(
	source: ScpStatementReadSource
): ScpStatementReadResult {
	return {
		freshness: 'unavailable',
		freshnessMs: null,
		observations: [],
		observedAt: null,
		source
	};
}

function isMeilisearchSuitable(result: ScpStatementReadResult): boolean {
	return result.freshness === 'fresh' || result.freshness === 'empty';
}

function pagesEquivalent(
	left: readonly ScpStatementObservationV1[],
	right: readonly ScpStatementObservationV1[]
): boolean {
	if (left.length !== right.length) return false;
	const byHash = (observations: readonly ScpStatementObservationV1[]) =>
		observations
			.toSorted((a, b) => a.statementHash.localeCompare(b.statementHash))
			.map(stableJson);
	const rightRows = byHash(right);
	return byHash(left).every((value, index) => value === rightRows[index]);
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
	if (typeof value !== 'object' || value === null)
		return JSON.stringify(value) ?? 'undefined';
	const entries = Object.entries(value).toSorted(([left], [right]) =>
		left.localeCompare(right)
	);
	return `{${entries
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
		.join(',')}}`;
}

function normalizeLimit(limit: number | undefined): number {
	if (limit === undefined) return DEFAULT_LIMIT;
	if (!Number.isInteger(limit)) return DEFAULT_LIMIT;
	if (limit < 1) return DEFAULT_LIMIT;

	return Math.min(limit, MAX_LIMIT);
}

function normalizeAnimationEventLimit(limit: number): number {
	if (!Number.isFinite(limit)) return DEFAULT_ANIMATION_EVENT_LIMIT;
	return Math.min(Math.max(Math.floor(limit), 1), MAX_ANIMATION_EVENT_LIMIT);
}

function normalizeNodeIds(
	nodeIds: readonly string[] | undefined
): readonly string[] | undefined {
	return nodeIds === undefined
		? undefined
		: [...new Set(nodeIds.filter((nodeId) => nodeId.length > 0))].toSorted();
}

function requireLastCursor(
	observations: readonly ScpStatementObservationV1[]
): ScpStatementLiveCursor {
	const last = observations.at(-1);
	if (last === undefined)
		throw new Error('SCP statement page cursor is missing');
	const observedAtMs = Date.parse(last.observedAt);
	if (!Number.isFinite(observedAtMs)) {
		throw new Error('SCP statement page cursor timestamp is invalid');
	}
	return { observedAtMs, statementHash: last.statementHash };
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
