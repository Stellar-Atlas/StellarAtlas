import type { EntityManager } from 'typeorm';
import { compactTemplateCache } from './HistoryArchiveCompactTemplateCache.js';
import { resolveReusableCompletionsSql } from './HistoryArchiveContentCompletionReferenceSql.js';
import type { HistoryArchiveContentCompletionUpdate } from './HistoryArchiveContentReuseWrite.js';
import { historyArchiveCompletionWriteConfigFromEnv } from '../../../use-cases/reconcile-history-archive-object-transitions/HistoryArchiveMaintenanceConfig.js';

interface SeedState {
	readonly known: Set<string>;
	active: boolean;
	retryAt: number;
}
const states = new WeakMap<object, SeedState>();

// At most one bounded seed batch per DataSource, committed BEFORE any target
// claim/queue lock. Failure never authorizes a completion or prevents the old
// validator running; the one-minute cooldown avoids recurring timeout tax.
export async function seedHistoryArchiveDbCompactTemplates(
	manager: EntityManager,
	updates: readonly HistoryArchiveContentCompletionUpdate[]
): Promise<void> {
	if (
		process.env.HISTORY_ARCHIVE_DB_COMPACT_TEMPLATES_ENABLED !== 'true' ||
		process.env.HISTORY_ARCHIVE_COMPACT_CONTENT_FACTS_ENABLED !== 'true'
	)
		return;
	let state = states.get(manager.connection);
	if (state === undefined) {
		state = { known: new Set(), active: false, retryAt: 0 };
		states.set(manager.connection, state);
	}
	if (state.active || Date.now() < state.retryAt) return;
	const cache = compactTemplateCache(manager);
	const byArtifact = new Map(
		updates.flatMap(({ remoteId, progress }) => {
			const reuse = progress.contentReuse;
			if (
				reuse === undefined ||
				progress.scheduler !== 'broker' ||
				progress.executionId === undefined ||
				state.known.has(reuse.artifactId) ||
				cache.get(reuse, progress.claimAttempt) === undefined
			)
				return [];
			return [
				[
					reuse.artifactId,
					{
						...reuse,
						remoteId,
						claimAttempt: progress.claimAttempt,
						executionId: progress.executionId,
						omitVerificationFacts: true
					}
				] as const
			];
		})
	);
	const input = [...byArtifact.values()]
		.sort((a, b) => a.artifactId.localeCompare(b.artifactId))
		.slice(0, historyArchiveCompletionWriteConfigFromEnv().batchSize);
	if (input.length === 0) return;
	state.active = true;
	try {
		const rows = await manager.connection.transaction(async (seedManager) => {
			await seedManager.query(
				`set local lock_timeout='250ms'; set local statement_timeout='3s'`
			);
			return (await seedManager.query(seedHistoryArchiveDbCompactTemplatesSql, [
				JSON.stringify(input)
			])) as readonly { artifactId: string }[];
		});
		for (const row of rows) {
			state.known.add(row.artifactId);
			if (state.known.size > 4096)
				state.known.delete(state.known.values().next().value!);
		}
	} catch {
		state.retryAt = Date.now() + 60_000;
	} finally {
		state.active = false;
	}
}

export const seedHistoryArchiveDbCompactTemplatesSql = `
with valid as materialized (${resolveReusableCompletionsSql}), identities as materialized (
	select distinct "artifactId" from valid where "activeClaim" and "artifactId" is not null
), seeded as (
	insert into public.history_archive_content_compact_template ("artifactId")
	select identities."artifactId" from identities
	where not exists (select 1 from public.history_archive_content_compact_template existing
		where existing."artifactId"=identities."artifactId")
	order by identities."artifactId" on conflict ("artifactId") do nothing returning "artifactId"
)
select "artifactId" from seeded union
select cached."artifactId" from identities join public.history_archive_content_compact_template cached
	on cached."artifactId"=identities."artifactId";
`;
