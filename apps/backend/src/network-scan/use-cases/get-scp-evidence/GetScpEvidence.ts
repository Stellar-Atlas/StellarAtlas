import { err, ok, type Result } from 'neverthrow';
import type { ScpStatementObservationV1, ScpStatementTypeV1 } from 'shared';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { GetKnownNodes } from '../get-known-nodes/GetKnownNodes.js';
import type {
	ScpStatementReadFreshness,
	ScpStatementReadSource,
	GetScpStatements
} from '../get-scp-statements/GetScpStatements.js';

export type ScpSemanticEventKind =
	| 'nomination_observed'
	| 'prepare_observed'
	| 'commit_observed'
	| 'externalized';

export interface ScpSemanticEvent {
	readonly eventId: string;
	readonly kind: ScpSemanticEventKind;
	readonly nodeId: string;
	readonly observedAt: string;
	readonly organizationId: string | null;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statement: ScpStatementObservationV1;
	readonly transactionSetHashes: readonly string[];
}

export interface ScpEvidenceMetadata {
	readonly freshness: ScpStatementReadFreshness;
	readonly freshnessMs: number | null;
	readonly observedAt: string | null;
	readonly source: ScpStatementReadSource;
}

export interface ScpSlotEvidence {
	readonly events: readonly ScpSemanticEvent[];
	readonly metadata: ScpEvidenceMetadata;
	readonly phaseCounts: Record<ScpStatementTypeV1, number>;
	readonly slotIndex: string;
	readonly statementCount: number;
	readonly validatorCount: number;
}

const maxStatements = 1000;

export class GetScpEvidence {
	constructor(
		private readonly getScpStatements: GetScpStatements,
		private readonly getKnownNodes: GetKnownNodes
	) {}

	async getLatestSlots(
		limit = 12
	): Promise<Result<readonly ScpSlotEvidence[], Error>> {
		const boundedSlots = Math.min(Math.max(Math.floor(limit), 1), 25);
		const read = await this.read({ limit: maxStatements });
		if (read.isErr()) return err(read.error);
		const nodeOrganizations = await this.nodeOrganizations();
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		const slots = groupBySlot(read.value.observations);
		return ok(
			[...slots.entries()]
				.toSorted(([left], [right]) => compareSequence(right, left))
				.slice(0, boundedSlots)
				.map(([slotIndex, statements]) =>
					toSlotEvidence(
						slotIndex,
						statements,
						read.value,
						nodeOrganizations.value
					)
				)
		);
	}

	async getSlot(
		slotIndex: string,
		limit = maxStatements
	): Promise<Result<ScpSlotEvidence, Error>> {
		const read = await this.read({ limit: boundedLimit(limit), slotIndex });
		if (read.isErr()) return err(read.error);
		const nodeOrganizations = await this.nodeOrganizations();
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		return ok(
			toSlotEvidence(
				slotIndex,
				read.value.observations,
				read.value,
				nodeOrganizations.value
			)
		);
	}

	async getValidator(
		nodeId: string,
		limit = 200
	): Promise<Result<ScpSlotEvidence[], Error>> {
		return this.getParticipantEvidence({ limit, nodeId });
	}

	async getOrganization(
		organizationId: string,
		limit = 500
	): Promise<Result<ScpSlotEvidence[], Error>> {
		const nodeOrganizations = await this.nodeOrganizations();
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		const nodeIds = [...nodeOrganizations.value]
			.filter(([, candidate]) => candidate === organizationId)
			.map(([nodeId]) => nodeId)
			.toSorted();
		if (nodeIds.length === 0) return ok([]);
		const maximum = boundedLimit(limit);
		const perNodeLimit = Math.max(1, Math.ceil(maximum / nodeIds.length));
		const observations: ScpStatementObservationV1[] = [];
		let metadata: ScpEvidenceMetadata = {
			freshness: 'empty',
			freshnessMs: null,
			observedAt: null,
			source: 'postgres_canonical'
		};
		for (const nodeId of nodeIds) {
			const read = await this.read({ limit: perNodeLimit, nodeId });
			if (read.isErr()) return err(read.error);
			observations.push(...read.value.observations);
			metadata = fresherMetadata(metadata, read.value);
		}
		const bounded = observations
			.toSorted((left, right) =>
				right.observedAt.localeCompare(left.observedAt)
			)
			.slice(0, maximum);
		return ok(
			[...groupBySlot(bounded)].map(([slot, rows]) =>
				toSlotEvidence(slot, rows, metadata, nodeOrganizations.value)
			)
		);
	}

	private async getParticipantEvidence(filter: {
		readonly limit: number;
		readonly nodeId?: string;
	}): Promise<Result<ScpSlotEvidence[], Error>> {
		const read = await this.read({
			limit: boundedLimit(filter.limit),
			nodeId: filter.nodeId
		});
		if (read.isErr()) return err(read.error);
		const nodeOrganizations = await this.nodeOrganizations();
		if (nodeOrganizations.isErr()) return err(nodeOrganizations.error);
		return ok(
			[...groupBySlot(read.value.observations)].map(([slot, rows]) =>
				toSlotEvidence(slot, rows, read.value, nodeOrganizations.value)
			)
		);
	}

	private read(filter: {
		readonly limit: number;
		readonly nodeId?: string;
		readonly slotIndex?: string;
	}) {
		return this.getScpStatements.executeWithMetadata({
			...filter,
			order: 'desc',
			source: 'stored'
		});
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

function fresherMetadata(
	current: ScpEvidenceMetadata,
	candidate: ScpEvidenceMetadata
): ScpEvidenceMetadata {
	if (candidate.observedAt === null) return current;
	if (
		current.observedAt === null ||
		candidate.observedAt > current.observedAt
	) {
		return {
			freshness: candidate.freshness,
			freshnessMs: candidate.freshnessMs,
			observedAt: candidate.observedAt,
			source: candidate.source
		};
	}
	return current;
}

function toSlotEvidence(
	slotIndex: string,
	statements: readonly ScpStatementObservationV1[],
	metadata: ScpEvidenceMetadata,
	organizations: ReadonlyMap<string, string>
): ScpSlotEvidence {
	const phaseCounts = { confirm: 0, externalize: 0, nominate: 0, prepare: 0 };
	for (const statement of statements) phaseCounts[statement.statementType] += 1;
	return {
		events: statements.map((statement) =>
			toSemanticEvent(statement, organizations)
		),
		metadata: {
			freshness: metadata.freshness,
			freshnessMs:
				'freshnessMs' in metadata && typeof metadata.freshnessMs === 'number'
					? metadata.freshnessMs
					: null,
			observedAt: metadata.observedAt,
			source: metadata.source
		},
		phaseCounts,
		slotIndex,
		statementCount: statements.length,
		validatorCount: new Set(statements.map((statement) => statement.nodeId))
			.size
	};
}

function toSemanticEvent(
	statement: ScpStatementObservationV1,
	organizations: ReadonlyMap<string, string>
): ScpSemanticEvent {
	return {
		eventId: statement.statementHash,
		kind:
			statement.statementType === 'nominate'
				? 'nomination_observed'
				: statement.statementType === 'prepare'
					? 'prepare_observed'
					: statement.statementType === 'confirm'
						? 'commit_observed'
						: 'externalized',
		nodeId: statement.nodeId,
		observedAt: statement.observedAt,
		organizationId: organizations.get(statement.nodeId) ?? null,
		quorumSetHash: statement.pledges.quorumSetHash,
		slotIndex: statement.slotIndex,
		statement,
		transactionSetHashes: [
			...new Set(
				statement.values.map((value) => value.txSetHash).filter(Boolean)
			)
		]
	};
}

function groupBySlot(
	statements: readonly ScpStatementObservationV1[]
): Map<string, ScpStatementObservationV1[]> {
	const grouped = new Map<string, ScpStatementObservationV1[]>();
	for (const statement of statements)
		grouped.set(statement.slotIndex, [
			...(grouped.get(statement.slotIndex) ?? []),
			statement
		]);
	return grouped;
}

function boundedLimit(limit: number): number {
	return Math.min(
		Math.max(Number.isFinite(limit) ? Math.floor(limit) : 200, 1),
		maxStatements
	);
}

function compareSequence(left: string, right: string): number {
	const leftValue = BigInt(left);
	const rightValue = BigInt(right);
	return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
