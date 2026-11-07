import { EntitySchema, type DataSource } from 'typeorm';
import type {
	ExpertDirectoryCheckpoint,
	ExpertDirectoryEntry,
	ExpertDirectoryStore,
	ExpertDirectoryTransaction
} from './ExpertDirectoryImport.js';
import { EXPERT_DIRECTORY_SOURCE } from './ExpertDirectoryRecord.js';

export const ExpertDirectoryEntrySchema = new EntitySchema<{
	source: typeof EXPERT_DIRECTORY_SOURCE;
	address: string;
	evidence: ExpertDirectoryEntry;
}>({
	name: 'ExpertDirectoryEntry',
	tableName: 'expert_directory_entry',
	columns: {
		source: { type: 'text', primary: true },
		address: { type: 'text', primary: true },
		evidence: { type: 'jsonb' }
	}
});

export const ExpertDirectoryCheckpointSchema = new EntitySchema<
	ExpertDirectoryCheckpoint & { source: typeof EXPERT_DIRECTORY_SOURCE }
>({
	name: 'ExpertDirectoryCheckpoint',
	tableName: 'expert_directory_checkpoint',
	columns: {
		source: { type: 'text', primary: true },
		commit: { type: 'text' },
		observedAt: { name: 'observed_at', type: 'text' },
		previousCommit: { name: 'previous_commit', type: 'text', nullable: true },
		deltaSha256: { name: 'delta_sha256', type: 'text', nullable: true }
	}
});

export class TypeOrmExpertDirectoryStore implements ExpertDirectoryStore {
	constructor(private readonly dataSource: DataSource) {}

	transaction<T>(
		work: (transaction: ExpertDirectoryTransaction) => Promise<T>
	): Promise<T> {
		return this.dataSource.transaction('READ COMMITTED', async (manager) => {
			let checkpointRequired = false;
			let checkpointAttempted = false;
			const result = await work({
				async readCheckpoint(source) {
					assertExpertDirectorySource(source);
					const row = await manager.findOneBy(ExpertDirectoryCheckpointSchema, {
						source
					});
					if (!row) return null;
					return {
						commit: row.commit,
						observedAt: row.observedAt,
						previousCommit: row.previousCommit,
						deltaSha256: row.deltaSha256
					};
				},
				async readEntry(source, address) {
					assertExpertDirectorySource(source);
					const row = await manager.findOneBy(ExpertDirectoryEntrySchema, {
						source,
						address
					});
					return row?.evidence ?? null;
				},
				async writeEntry(entry) {
					assertExpertDirectorySource(entry.source);
					if (checkpointAttempted)
						throw new Error(
							'Directory entries must precede checkpoint advancement'
						);
					checkpointRequired = true;
					await manager.upsert(
						ExpertDirectoryEntrySchema,
						{ source: entry.source, address: entry.address, evidence: entry },
						['source', 'address']
					);
				},
				async advanceCheckpoint(source, expectedCommit, nextCheckpoint) {
					assertExpertDirectorySource(source);
					if (checkpointAttempted)
						throw new Error(
							'Directory checkpoint advancement already attempted'
						);
					checkpointAttempted = true;
					checkpointRequired = true;
					const { commit, observedAt, previousCommit, deltaSha256 } =
						nextCheckpoint;
					const { affected } = await manager.update(
						ExpertDirectoryCheckpointSchema,
						{ source, commit: expectedCommit },
						{ commit, observedAt, previousCommit, deltaSha256 }
					);
					if (affected !== 1)
						throw new Error('Directory checkpoint changed during import');
					checkpointRequired = false;
				}
			});
			if (checkpointRequired)
				throw new Error(
					'Directory transaction requires a successful checkpoint advance'
				);
			return result;
		});
	}
}

function assertExpertDirectorySource(source: unknown): void {
	if (source !== EXPERT_DIRECTORY_SOURCE)
		throw new Error('Unexpected directory source');
}
