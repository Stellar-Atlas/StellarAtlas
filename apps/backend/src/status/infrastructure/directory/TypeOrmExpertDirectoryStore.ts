import { EntitySchema, type DataSource, type EntityManager } from 'typeorm';
import type {
	ExpertDirectoryCheckpoint,
	ExpertDirectoryEntry,
	ExpertDirectoryStore,
	ExpertDirectoryTransaction
} from './ExpertDirectoryImport.js';
import { EXPERT_DIRECTORY_SOURCE, isGitOid, parseExpertDirectoryPath } from './ExpertDirectoryRecord.js';
import { MAX_EXPERT_SNAPSHOT_BATCH_BYTES, MAX_EXPERT_SNAPSHOT_BATCH_PATHS } from './ExpertDirectoryImport.js';

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

	/** Publish the validated snapshot as one transaction, including any tombstones. */
	publishSnapshot(
		checkpoint: ExpertDirectoryCheckpoint,
		batches: AsyncIterable<readonly ExpertDirectoryEntry[]>,
		signal?: AbortSignal
	) {
		const { commit, observedAt, previousCommit, deltaSha256 } = checkpoint;
		if (!isGitOid(commit) || (previousCommit !== null && !isGitOid(previousCommit)) ||
			previousCommit === commit ||
			!checkpoint.deltaSha256 || !/^[0-9a-f]{64}$/.test(checkpoint.deltaSha256) ||
			!Number.isFinite(Date.parse(observedAt)))
			throw new Error('Invalid directory snapshot checkpoint');
		signal?.throwIfAborted();
		return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
			const source = EXPERT_DIRECTORY_SOURCE;
			await boundDirectoryWrite(manager);
			const current = await lockCheckpoint(manager, source);
			if (current?.commit === commit) {
				if (current.previousCommit === previousCommit && current.deltaSha256 === deltaSha256)
					return { status: 'replayed' as const, checkpoint: current };
				throw new Error('Directory snapshot replay does not match its checkpoint');
			}
			if ((current?.commit ?? null) !== previousCommit)
				throw new Error('Directory snapshot base does not match the current checkpoint');
			if (!current && await manager.findOneBy(ExpertDirectoryEntrySchema, { source }))
				throw new Error('Directory has entries without a checkpoint');
			for await (const entries of batches) {
				signal?.throwIfAborted();
				if (!Array.isArray(entries) || !entries.length ||
					entries.length > MAX_EXPERT_SNAPSHOT_BATCH_PATHS ||
					Buffer.byteLength(JSON.stringify(entries)) > MAX_EXPERT_SNAPSHOT_BATCH_BYTES ||
					entries.some((entry: ExpertDirectoryEntry) => entry.source !== source ||
						entry.state !== 'active' || entry.commit !== commit || entry.observedAt !== observedAt))
					throw new Error('Invalid directory snapshot batch');
				const rows = entries.map((entry: ExpertDirectoryEntry) =>
					({ source: entry.source, address: entry.address, evidence: entry }));
				if (current) await manager.upsert(ExpertDirectoryEntrySchema, rows, ['source', 'address']);
				else await manager.insert(ExpertDirectoryEntrySchema, rows);
			}
			signal?.throwIfAborted();
			if (!current) {
				await manager.insert(ExpertDirectoryCheckpointSchema, { source, ...checkpoint });
				signal?.throwIfAborted();
				return { status: 'initialized' as const, checkpoint };
			}
			await tombstoneMissingEntries(manager, checkpoint, signal);
			signal?.throwIfAborted();
			await advanceDirectoryCheckpoint(manager, source, current.commit, checkpoint);
			signal?.throwIfAborted();
			return { status: 'refreshed' as const, checkpoint };
		});
	}

	transaction<T>(
		work: (transaction: ExpertDirectoryTransaction) => Promise<T>
	): Promise<T> {
		return this.dataSource.transaction('READ COMMITTED', async (manager) => {
			await boundDirectoryWrite(manager);
			let checkpointRequired = false;
			let checkpointAttempted = false;
			const result = await work({
				async readCheckpoint(source) {
					assertExpertDirectorySource(source);
					const row = await lockCheckpoint(manager, source);
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
					await advanceDirectoryCheckpoint(manager, source, expectedCommit, nextCheckpoint);
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

async function boundDirectoryWrite(manager: EntityManager): Promise<void> {
	await manager.query(
		"SELECT set_config('statement_timeout', '30s', true), set_config('lock_timeout', '2s', true)"
	);
}

function lockCheckpoint(manager: EntityManager, source: typeof EXPERT_DIRECTORY_SOURCE) {
	return manager.findOne(ExpertDirectoryCheckpointSchema, {
		where: { source },
		lock: { mode: 'pessimistic_write' }
	});
}

async function advanceDirectoryCheckpoint(
	manager: EntityManager,
	source: typeof EXPERT_DIRECTORY_SOURCE,
	expectedCommit: string,
	checkpoint: ExpertDirectoryCheckpoint
): Promise<void> {
	const { commit, observedAt, previousCommit, deltaSha256 } = checkpoint;
	const { affected } = await manager.update(
		ExpertDirectoryCheckpointSchema,
		{ source, commit: expectedCommit },
		{ commit, observedAt, previousCommit, deltaSha256 }
	);
	if (affected !== 1) throw new Error('Directory checkpoint changed during import');
}

async function tombstoneMissingEntries(
	manager: EntityManager,
	checkpoint: ExpertDirectoryCheckpoint,
	signal?: AbortSignal
): Promise<void> {
	const source = EXPERT_DIRECTORY_SOURCE;
	const { commit, observedAt } = checkpoint;
	let after = '';
	while (true) {
		signal?.throwIfAborted();
		const missing = await manager
			.createQueryBuilder(ExpertDirectoryEntrySchema, 'entry')
			.where('entry.source = :source', { source })
			.andWhere('entry.address COLLATE "C" > :after', { after })
			.andWhere("entry.evidence->>'state' = 'active' AND entry.evidence->>'commit' IS DISTINCT FROM :commit", { commit })
			.orderBy('entry.address COLLATE "C"', 'ASC')
			.limit(MAX_EXPERT_SNAPSHOT_BATCH_PATHS)
			.getMany();
		if (!missing.length) return;
		signal?.throwIfAborted();
		await manager.upsert(ExpertDirectoryEntrySchema, missing.map(({ address, evidence }) => {
			const identity = parseExpertDirectoryPath(evidence.sourcePath);
			if (evidence.state !== 'active' || !isGitOid(evidence.sourceBlobOid) ||
				identity.address !== address || evidence.address !== address ||
				evidence.addressKind !== identity.addressKind || evidence.source !== source)
				throw new Error('Directory refresh found an invalid predecessor');
			return { source, address, evidence: {
				...identity, source, sourcePath: evidence.sourcePath,
				previousBlobOid: evidence.sourceBlobOid, commit, observedAt, state: 'deleted' as const
			} };
		}), ['source', 'address']);
		if (missing.length < MAX_EXPERT_SNAPSHOT_BATCH_PATHS) return;
		after = missing[missing.length - 1]!.address;
	}
}

function assertExpertDirectorySource(source: unknown): void {
	if (source !== EXPERT_DIRECTORY_SOURCE)
		throw new Error('Unexpected directory source');
}
