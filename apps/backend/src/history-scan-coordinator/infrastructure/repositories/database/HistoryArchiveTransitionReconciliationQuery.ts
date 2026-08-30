import type { HistoryArchiveTransitionReconciliationV1 } from 'shared';
import type { EntityManager } from 'typeorm';
import { requireNumber, type NumericValue } from './ScanJobRowMapper.js';

const stalledAfterMs = 60_000;

type ReconciliationRow = {
	readonly oldestPendingAt?: Date | string | null;
	readonly oldestpendingat?: Date | string | null;
	readonly pendingTerminalEffects?: NumericValue;
	readonly pendingterminaleffects?: NumericValue;
};

export async function getHistoryArchiveTransitionReconciliation(
	manager: EntityManager,
	generatedAt: Date
): Promise<HistoryArchiveTransitionReconciliationV1> {
	const [row] = (await manager.query(
		historyArchiveTransitionReconciliationHealthSql
	)) as readonly ReconciliationRow[];
	const pendingTerminalEffects = requireNumber(
		row?.pendingTerminalEffects ?? row?.pendingterminaleffects ?? 0,
		'pendingTerminalEffects'
	);
	const rawOldestPendingAt =
		row?.oldestPendingAt ?? row?.oldestpendingat ?? null;
	const oldestPendingAt = rawOldestPendingAt
		? new Date(rawOldestPendingAt)
		: null;
	const oldestPendingAgeMs = oldestPendingAt
		? Math.max(0, generatedAt.getTime() - oldestPendingAt.getTime())
		: null;

	return {
		oldestPendingAgeMs,
		oldestPendingAt: oldestPendingAt?.toISOString() ?? null,
		pendingTerminalEffects,
		status:
			pendingTerminalEffects === 0
				? 'caught-up'
				: (oldestPendingAgeMs ?? 0) >= stalledAfterMs
					? 'stalled'
					: 'reconciling'
	};
}

export const historyArchiveTransitionReconciliationHealthSql = `
	select
		count(*)::bigint as "pendingTerminalEffects",
		min(object."transitionEffectsRequiredAt") as "oldestPendingAt"
	from "history_archive_object_queue" object
	where object.status in ('verified', 'failed')
		and object."transitionEffectsRequiredAt" is not null
		and object."transitionEffectsCompletedAt" is null
`;
