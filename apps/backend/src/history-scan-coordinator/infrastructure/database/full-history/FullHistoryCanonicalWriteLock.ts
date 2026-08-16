import type { EntityManager } from 'typeorm';
import type { FullHistoryHash } from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

const canonicalWriterLockTimeout = '25s';
const ordinaryCanonicalLockTimeout = '2s';

/**
 * Acquire this only after the direction-specific frontier lock. Keeping that
 * order lets forward and historical validation proceed independently while
 * ensuring their write-heavy commit phases cannot overlap for one network.
 * The wider timeout covers the observed 8-20 second canonical commits without
 * weakening the two-second bound on subsequent canonical database writes.
 */
export async function lockFullHistoryCanonicalWriter(
	manager: EntityManager,
	networkHash: FullHistoryHash
): Promise<void> {
	await manager.query(
		`set local lock_timeout = '${canonicalWriterLockTimeout}'`
	);
	await manager.query(
		'select pg_advisory_xact_lock(hashtextextended($1, 178485))',
		[networkHash.toHex()]
	);
	await manager.query(
		`set local lock_timeout = '${ordinaryCanonicalLockTimeout}'`
	);
}
