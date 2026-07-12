import type { EntityManager } from 'typeorm';
import type {
	ScpStatementAnimationObservation,
	ScpStatementAnimationValue
} from '@network-scan/domain/scp/ScpStatementObservationRepository.js';

interface AnimationObservationRow {
	readonly nodeId: string;
	readonly observedAt: Date | string;
	readonly observedFromPeer: string;
	readonly quorumSetHash: string;
	readonly slotIndex: string;
	readonly statementHash: string;
	readonly statementType: ScpStatementAnimationObservation['statementType'];
	readonly values: ScpStatementAnimationValue[];
}

const maximumSlotCount = 25;

export async function findLatestScpAnimationSlots(
	manager: EntityManager,
	limit: number
): Promise<ScpStatementAnimationObservation[]> {
	const boundedLimit = Math.min(
		Math.max(Math.floor(limit), 1),
		maximumSlotCount
	);
	const rows = (await manager.query(
		`
			with latest_slots as materialized (
				select distinct "slotIndex"
				from scp_statement_observation
				order by "slotIndex" desc
				limit $1
			)
			select observation."nodeId", observation."observedAt",
				observation."observedFromPeer",
				coalesce(observation.pledges->>'quorumSetHash', '')
					as "quorumSetHash",
				observation."slotIndex"::text as "slotIndex",
				observation."statementHash", observation."statementType",
				coalesce((
					select jsonb_agg(jsonb_build_object(
						'closeTime', value->>'closeTime',
						'txSetHash', value->>'txSetHash'
					))
					from jsonb_array_elements(observation.values) value
				), '[]'::jsonb) as values
			from scp_statement_observation observation
			join latest_slots on latest_slots."slotIndex" =
				observation."slotIndex"
			order by observation."slotIndex" desc,
				observation."observedAt" asc,
				observation."statementHash" asc
		`,
		[boundedLimit]
	)) as AnimationObservationRow[];

	return rows.map((row) => ({
		nodeId: row.nodeId,
		observedAt:
			row.observedAt instanceof Date
				? row.observedAt
				: new Date(row.observedAt),
		observedFromPeer: row.observedFromPeer,
		quorumSetHash: row.quorumSetHash,
		slotIndex: row.slotIndex,
		statementHash: row.statementHash,
		statementType: row.statementType,
		values: row.values
	}));
}
