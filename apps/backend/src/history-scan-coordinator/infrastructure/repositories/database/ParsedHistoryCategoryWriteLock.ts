import type { EntityManager } from 'typeorm';
import type { ParsedTransactionIdentity } from '../../../domain/parsed-history/ParsedTransactionConflictError.js';

export async function lockParsedHistoryCategoryWrites(
	manager: EntityManager,
	identities: readonly ParsedTransactionIdentity[]
): Promise<void> {
	const lockKeys = [
		...new Set(
			identities.map(
				(identity) => `${identity.category}:${identity.categoryHash}`
			)
		)
	].sort();
	if (lockKeys.length === 0) return;
	await manager.query(
		`select pg_advisory_xact_lock(hashtextextended(lock_key, 0))
		 from unnest($1::text[]) as locks(lock_key)`,
		[lockKeys]
	);
}
