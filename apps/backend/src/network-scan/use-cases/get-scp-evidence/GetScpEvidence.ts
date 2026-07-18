import { err, ok, type Result } from 'neverthrow';
import type { ScpStatementReadCursor } from '../../domain/scp/ScpStatementObservationRepository.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { GetKnownNodes } from '../get-known-nodes/GetKnownNodes.js';
import type {
	ScpAnimationStatement,
	ScpStoredStatementPageReadResult,
	GetScpStatements
} from '../get-scp-statements/GetScpStatements.js';
import {
	buildBoundedCompactResponse,
	type ScpCompactDeliveryPolicy
} from './ScpCompactDelivery.js';
import {
	cursorForStatement,
	encodeScpEvidenceCursor
} from './ScpEvidenceCursor.js';
import type {
	ScpAnimationBacklog,
	ScpEvidenceMetadata,
	ScpEvidencePage,
	ScpLatestSlots
} from './ScpEvidenceDTO.js';
import {
	groupStatementsBySlot,
	toAnimationSlotEvidence,
	toEvidenceMetadata,
	toSlotEvidence
} from './ScpEvidenceMapper.js';

export type {
	ScpAnimationBacklog,
	ScpAnimationSemanticEvent,
	ScpCompactDeliveryMetadata,
	ScpEvidenceMetadata,
	ScpEvidencePage,
	ScpEvidencePageMetadata,
	ScpLatestSlotEvidence,
	ScpLatestSlots,
	ScpSemanticEvent,
	ScpSemanticEventKind,
	ScpSlotEvidence
} from './ScpEvidenceDTO.js';

export interface GetScpEvidenceOptions {
	readonly compactByteLimit?: number;
	readonly compactEventLimit?: number;
}

export const scpCompactDeliveryLimits = {
	byteLimit: 262_144,
	eventLimit: 512
} as const;

const maximumSlotCount = 25;
const maximumStatementPageSize = 1_000;
const minimumCompactByteLimit = 4_096;
const compactCandidateLimit = 4_001;

export class GetScpEvidence {
	private readonly compactPolicy: ScpCompactDeliveryPolicy;

	constructor(
		private readonly getScpStatements: GetScpStatements,
		private readonly getKnownNodes: GetKnownNodes,
		options: GetScpEvidenceOptions = {}
	) {
		this.compactPolicy = normalizeCompactPolicy(options);
	}

	async getLatestSlots(limit = 12): Promise<Result<ScpLatestSlots, Error>> {
		const slotLimit = boundedSlotLimit(limit);
		const compactRead = await this.readCompactCandidates(slotLimit);
		if (compactRead.isErr()) return err(compactRead.error);
		const { metadata, observations, organizations } = compactRead.value;
		return ok(
			buildBoundedCompactResponse(
				observations,
				this.compactPolicy,
				cursorForStatement,
				(statements, delivery) => ({
					delivery,
					slots: sortedSlots(groupStatementsBySlot(statements)).map(
						([slotIndex, rows]) =>
							toAnimationSlotEvidence(slotIndex, rows, metadata, organizations)
					)
				})
			)
		);
	}

	async getAnimationBacklog(
		limit = 4
	): Promise<Result<ScpAnimationBacklog, Error>> {
		const slotLimit = boundedSlotLimit(limit);
		const compactRead = await this.readCompactCandidates(slotLimit);
		if (compactRead.isErr()) return err(compactRead.error);
		const { metadata, observations } = compactRead.value;
		return ok(
			buildBoundedCompactResponse(
				observations,
				this.compactPolicy,
				cursorForStatement,
				(statements, delivery) => {
					const slots = sortedSlots(groupStatementsBySlot(statements)).map(
						([slotIndex, rows]) => ({ slotIndex, statements: rows })
					);
					return {
						delivery,
						metadata,
						slots,
						statementCount: delivery.eventCount
					};
				}
			)
		);
	}

	private async readCompactCandidates(slotLimit: number): Promise<
		Result<
			{
				readonly metadata: ScpEvidenceMetadata;
				readonly observations: readonly ScpAnimationStatement[];
				readonly organizations: ReadonlyMap<string, string>;
			},
			Error
		>
	> {
		const [read, nodeOrganizations] = await Promise.all([
			this.getScpStatements.executeLatestAnimationSlots(
				slotLimit,
				compactCandidateLimit
			),
			this.nodeOrganizations()
		]);
		if (read.isErr()) return err(read.error);
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		const organizations = nodeOrganizations.value;
		const candidates = selectLatestSlots(read.value.observations, slotLimit);
		return ok({
			metadata: toEvidenceMetadata(read.value),
			observations: prioritizeCompactRepresentatives(candidates, organizations),
			organizations
		});
	}

	async getSlot(
		slotIndex: string,
		limit = maximumStatementPageSize,
		after?: ScpStatementReadCursor
	): Promise<Result<ScpEvidencePage, Error>> {
		return this.getDetailedEvidence({ after, limit, slotIndex });
	}

	async getValidator(
		nodeId: string,
		limit = 200,
		after?: ScpStatementReadCursor
	): Promise<Result<ScpEvidencePage, Error>> {
		return this.getDetailedEvidence({ after, limit, nodeId });
	}

	async getOrganization(
		organizationId: string,
		limit = 500,
		after?: ScpStatementReadCursor
	): Promise<Result<ScpEvidencePage, Error>> {
		const nodeOrganizations = await this.nodeOrganizations();
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		const nodeIds = [...nodeOrganizations.value]
			.filter(([, candidate]) => candidate === organizationId)
			.map(([nodeId]) => nodeId)
			.toSorted();
		const pageLimit = boundedPageLimit(limit);
		if (nodeIds.length === 0) {
			return ok(emptyEvidencePage(pageLimit));
		}
		const read = await this.getScpStatements.executeStoredPageWithMetadata({
			after,
			limit: pageLimit,
			nodeIds,
			order: 'desc'
		});
		if (read.isErr()) return err(read.error);
		return ok(toEvidencePage(read.value, nodeOrganizations.value));
	}

	private async getDetailedEvidence(filter: {
		readonly after?: ScpStatementReadCursor;
		readonly limit: number;
		readonly nodeId?: string;
		readonly slotIndex?: string;
	}): Promise<Result<ScpEvidencePage, Error>> {
		const read = await this.getScpStatements.executeStoredPageWithMetadata({
			...filter,
			limit: boundedPageLimit(filter.limit),
			order: 'desc'
		});
		if (read.isErr()) return err(read.error);
		const nodeOrganizations = await this.nodeOrganizations();
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		return ok(toEvidencePage(read.value, nodeOrganizations.value));
	}

	private async nodeOrganizations(): Promise<
		Result<ReadonlyMap<string, string>, Error>
	> {
		try {
			const inventory = await this.getKnownNodes.executeAll();
			if (inventory.isErr()) return err(inventory.error);
			return ok(
				new Map(
					inventory.value.nodes.flatMap((knownNode) => {
						const organizationId = knownNode.node?.organizationId;
						return organizationId
							? [[knownNode.publicKey, organizationId] as const]
							: [];
					})
				)
			);
		} catch (error) {
			return err(mapUnknownToError(error));
		}
	}
}

function toEvidencePage(
	read: ScpStoredStatementPageReadResult,
	organizations: ReadonlyMap<string, string>
): ScpEvidencePage {
	const metadata = toEvidenceMetadata(read);
	return {
		metadata,
		page: {
			hasMore: read.page.hasMore,
			limit: read.page.limit,
			nextCursor:
				read.page.nextCursor === null
					? null
					: encodeScpEvidenceCursor(read.page.nextCursor)
		},
		slots: sortedSlots(groupStatementsBySlot(read.observations)).map(
			([slotIndex, rows]) =>
				toSlotEvidence(slotIndex, rows, metadata, organizations)
		),
		statementCount: read.observations.length
	};
}

function emptyEvidencePage(limit: number): ScpEvidencePage {
	return {
		metadata: {
			freshness: 'empty',
			freshnessMs: null,
			observedAt: null,
			source: 'postgres_canonical'
		},
		page: { hasMore: false, limit, nextCursor: null },
		slots: [],
		statementCount: 0
	};
}

function normalizeCompactPolicy(
	options: GetScpEvidenceOptions
): ScpCompactDeliveryPolicy {
	return {
		byteLimit: boundedNumber(
			options.compactByteLimit,
			minimumCompactByteLimit,
			scpCompactDeliveryLimits.byteLimit
		),
		eventLimit: boundedNumber(
			options.compactEventLimit,
			1,
			scpCompactDeliveryLimits.eventLimit
		)
	};
}

function boundedNumber(
	value: number | undefined,
	minimum: number,
	maximum: number
): number {
	if (value === undefined || !Number.isFinite(value)) return maximum;
	return Math.min(Math.max(Math.floor(value), minimum), maximum);
}

function boundedSlotLimit(limit: number): number {
	return boundedNumber(limit, 1, maximumSlotCount);
}

function boundedPageLimit(limit: number): number {
	return boundedNumber(limit, 1, maximumStatementPageSize);
}

function sortedSlots<T>(grouped: Map<string, T[]>): [string, T[]][] {
	return [...grouped.entries()].toSorted(([left], [right]) =>
		compareSequence(right, left)
	);
}

function selectLatestSlots<T extends { readonly slotIndex: string }>(
	statements: readonly T[],
	limit: number
): T[] {
	const selectedSlots = new Set(
		sortedSlots(groupStatementsBySlot(statements))
			.slice(0, limit)
			.map(([slotIndex]) => slotIndex)
	);
	return statements.filter(({ slotIndex }) => selectedSlots.has(slotIndex));
}

function prioritizeCompactRepresentatives(
	statements: readonly ScpAnimationStatement[],
	organizations: ReadonlyMap<string, string>
): ScpAnimationStatement[] {
	const ordered = statements.toSorted(compareAnimationStatements);
	const representativeByGroup = new Map<string, ScpAnimationStatement>();
	for (const statement of ordered) {
		const organizationId = organizations.get(statement.nodeId);
		if (organizationId === undefined) continue;
		const group = `${statement.slotIndex}\u0000${statement.statementType}\u0000${organizationId}`;
		if (!representativeByGroup.has(group)) {
			representativeByGroup.set(group, statement);
		}
	}
	const representatives = [...representativeByGroup.values()];
	const selected = new Set(representatives);
	return [
		...representatives,
		...ordered.filter((statement) => !selected.has(statement))
	];
}

function compareAnimationStatements(
	left: ScpAnimationStatement,
	right: ScpAnimationStatement
): number {
	return (
		compareSequence(right.slotIndex, left.slotIndex) ||
		left.observedAt.localeCompare(right.observedAt) ||
		left.statementHash.localeCompare(right.statementHash)
	);
}

function compareSequence(left: string, right: string): number {
	const leftValue = BigInt(left);
	const rightValue = BigInt(right);
	return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
