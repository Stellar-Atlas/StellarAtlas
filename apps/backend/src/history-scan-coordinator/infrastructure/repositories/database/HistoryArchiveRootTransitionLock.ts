import type { EntityManager } from 'typeorm';

export const historyArchiveRootTransitionLockSql = `
    select pg_advisory_xact_lock(
        1784950001,
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

export const historyArchiveObjectRootTransitionLockSql = `
    select pg_advisory_xact_lock(
        1784950001,
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
