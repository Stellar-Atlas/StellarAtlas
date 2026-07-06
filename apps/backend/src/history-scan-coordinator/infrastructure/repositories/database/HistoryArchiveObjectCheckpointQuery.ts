import type { EntityManager } from 'typeorm';
import { requireNumber } from './ScanJobRowMapper.js';

const checkpointLookupChunkSize = 250;

export async function findOldestCheckpointLedgers(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[]
): Promise<ReadonlyMap<string, number>> {
	const uniqueIdentities = [...new Set(archiveUrlIdentities)];
	const checkpoints = new Map<string, number>();

	for (let index = 0; index < uniqueIdentities.length; index += checkpointLookupChunkSize) {
		const chunk = uniqueIdentities.slice(index, index + checkpointLookupChunkSize);
		const rows = await manager.query(
			`
			select
				"archiveUrlIdentity" as "archiveUrlIdentity",
				min("checkpointLedger")::integer as "checkpointLedger"
			from history_archive_object_queue
			where "archiveUrlIdentity" in (${chunk
				.map((_, parameterIndex) => `$${parameterIndex + 1}`)
				.join(', ')})
				and "objectType" = 'checkpoint-state'
				and "checkpointLedger" is not null
			group by "archiveUrlIdentity"
			`,
			chunk
		);

		for (const row of rows) {
			checkpoints.set(
				String(row.archiveUrlIdentity),
				requireNumber(row.checkpointLedger, 'checkpointLedger')
			);
		}
	}

	return checkpoints;
}
