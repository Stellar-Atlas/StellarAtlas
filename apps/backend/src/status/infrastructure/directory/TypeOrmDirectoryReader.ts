import type { DataSource, EntityManager } from 'typeorm';
import type {
	ImportedDirectoryReader,
	ImportedDirectorySnapshot
} from './DirectoryReader.js';
import type { ExpertDirectoryEntry } from './ExpertDirectoryImport.js';
import { EXPERT_DIRECTORY_SOURCE } from './ExpertDirectoryRecord.js';
import {
	ExpertDirectoryCheckpointSchema,
	ExpertDirectoryEntrySchema
} from './TypeOrmExpertDirectoryStore.js';

const source = EXPERT_DIRECTORY_SOURCE;
const addressOrder = 'entry.address COLLATE "C"';
const upperAscii = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const lowerAscii = 'abcdefghijklmnopqrstuvwxyz';

export class TypeOrmDirectoryReader implements ImportedDirectoryReader {
	constructor(private readonly dataSource: DataSource) {}

	lookup(address: string): Promise<ImportedDirectorySnapshot> {
		return this.read(async (manager) => {
			const row = await manager.findOneBy(ExpertDirectoryEntrySchema, {
				source,
				address
			});
			return row ? [row.evidence] : [];
		});
	}

	search(
		input: Parameters<ImportedDirectoryReader['search']>[0]
	): Promise<ImportedDirectorySnapshot> {
		const { prefix, after, take, atlasAddresses } = input;
		return this.read(async (manager) => {
			const atlasMatch = atlasAddresses.length
				? ' OR entry.address IN (:...atlasAddresses)'
				: '';
			const rows = await manager
				.createQueryBuilder(ExpertDirectoryEntrySchema, 'entry')
				.where('entry.source = :source', { source })
				.andWhere(addressOrder + ' > :after', { after })
				.andWhere(
					`((entry.evidence->>'state' = 'active' AND (
						starts_with(translate(entry.address, :upper, :lower), :prefix) OR
						starts_with(translate(entry.evidence->>'name', :upper, :lower), :prefix) OR
						starts_with(translate(entry.evidence->>'domain', :upper, :lower), :prefix)
					))${atlasMatch})`,
					{ prefix, upper: upperAscii, lower: lowerAscii, atlasAddresses }
				)
				.orderBy(addressOrder, 'ASC')
				.limit(take)
				.getMany();
			return rows.map((row) => row.evidence);
		});
	}

	private read(
		readEntries: (
			manager: EntityManager
		) => Promise<readonly ExpertDirectoryEntry[]>
	): Promise<ImportedDirectorySnapshot> {
		return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
			await manager.query('SET TRANSACTION READ ONLY');
			await manager.query(
				`SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)`,
				['1000ms', '250ms']
			);
			const checkpoint = await manager.findOneBy(
				ExpertDirectoryCheckpointSchema,
				{ source }
			);
			return {
				checkpoint,
				entries: checkpoint ? await readEntries(manager) : []
			};
		});
	}
}
