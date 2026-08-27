import type { EntityManager } from 'typeorm';

export const historyArchiveRootTransitionLockSql = `
    select pg_advisory_xact_lock(
        1784950002,
        hashtext($1::text)
    )
`;

export async function lockHistoryArchiveRootTransition(
	manager: EntityManager,
	archiveUrlIdentity: string
): Promise<void> {
	await manager.query(historyArchiveRootTransitionLockSql, [
		archiveUrlIdentity
	]);
}

export const historyArchiveRootTransitionLocksSql = `
	select pg_advisory_xact_lock(
                1784950002,
		hashtext(roots."archiveUrlIdentity")
	)
	from (
		select distinct unnest($1::text[]) as "archiveUrlIdentity"
	) roots
	order by roots."archiveUrlIdentity"
`;

export async function lockHistoryArchiveRootTransitions(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[]
): Promise<void> {
	if (archiveUrlIdentities.length === 0) return;
	await manager.query(historyArchiveRootTransitionLocksSql, [
		[...archiveUrlIdentities]
	]);
}

export const historyArchiveObjectRootTransitionLockSql = `
    select pg_advisory_xact_lock(
        1784950002,
        hashtext(object."archiveUrlIdentity")
    )
    from "history_archive_object_queue" object
    where object."remoteId" = $1::uuid
`;

export async function lockHistoryArchiveObjectRootTransition(
	manager: EntityManager,
	remoteId: string
): Promise<void> {
	await manager.query(historyArchiveObjectRootTransitionLockSql, [remoteId]);
}

export const historyArchiveObjectRootTransitionLocksSql = `
        select pg_advisory_xact_lock(
                1784950002,
                hashtext(roots."archiveUrlIdentity")
        )
        from (
                select distinct object."archiveUrlIdentity"
                from "history_archive_object_queue" object
                where object."remoteId" = any($1::uuid[])
        ) roots
        order by roots."archiveUrlIdentity"
`;

export async function lockHistoryArchiveObjectRootTransitions(
	manager: EntityManager,
	remoteIds: readonly string[]
): Promise<void> {
	if (remoteIds.length === 0) return;
	await manager.query(historyArchiveObjectRootTransitionLocksSql, [
		[...remoteIds]
	]);
}
