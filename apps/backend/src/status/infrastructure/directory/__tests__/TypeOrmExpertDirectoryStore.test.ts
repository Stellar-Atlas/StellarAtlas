import { DataSource, type EntityManager } from 'typeorm';
import type {
	ExpertDirectoryCheckpoint,
	ExpertDirectoryEntry
} from '../ExpertDirectoryImport.js';
import { EXPERT_DIRECTORY_SOURCE as source } from '../ExpertDirectoryRecord.js';
import {
	ExpertDirectoryCheckpointSchema,
	ExpertDirectoryEntrySchema,
	TypeOrmExpertDirectoryStore
} from '../TypeOrmExpertDirectoryStore.js';

const baseCommit = 'a'.repeat(40);
const nextCheckpoint: ExpertDirectoryCheckpoint = {
	commit: 'b'.repeat(40),
	observedAt: '2026-11-04T20:30:00.000Z',
	previousCommit: baseCommit,
	deltaSha256: 'c'.repeat(64)
};
const active: ExpertDirectoryEntry = {
	state: 'active',
	source,
	address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
	addressKind: 'account',
	sourcePath:
		'accounts/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF.json',
	sourceBlobOid: 'd'.repeat(40),
	contentSha256: 'e'.repeat(64),
	name: 'Example',
	domain: null,
	tags: [],
	version: 1,
	publisher: 'StellarExpert',
	license: 'MIT',
	networkApplicability: 'unspecified',
	commit: baseCommit,
	observedAt: '2026-11-04T20:00:00.000Z'
};
const tombstone: ExpertDirectoryEntry = {
	state: 'deleted',
	source,
	address: active.address,
	addressKind: active.addressKind,
	sourcePath: active.sourcePath,
	previousBlobOid: active.sourceBlobOid,
	commit: nextCheckpoint.commit,
	observedAt: nextCheckpoint.observedAt
};

function transactionFixture(
	affected?: number,
	dataSource = new DataSource({ type: 'postgres' })
) {
	const manager = {
		query: jest.fn(),
		findOne: jest.fn<ReturnType<EntityManager['findOne']>, Parameters<EntityManager['findOne']>>(),
		findOneBy: jest.fn<
			ReturnType<EntityManager['findOneBy']>,
			Parameters<EntityManager['findOneBy']>
		>(),
		insert: jest.fn().mockResolvedValue({ identifiers: [], generatedMaps: [], raw: [] }),
		upsert: jest.fn<
			ReturnType<EntityManager['upsert']>,
			Parameters<EntityManager['upsert']>
		>(),
		update: jest
			.fn<
				ReturnType<EntityManager['update']>,
				Parameters<EntityManager['update']>
			>()
			.mockResolvedValue({ affected, raw: [], generatedMaps: [] })
	};
	const transaction = jest
		.spyOn(dataSource, 'transaction')
		.mockImplementation(async (_isolation, work) =>
			work(manager as unknown as EntityManager)
		);
	return {
		manager,
		store: new TypeOrmExpertDirectoryStore(dataSource),
		transaction
	};
}

async function* snapshotBatches(...batches: readonly ExpertDirectoryEntry[][]) {
	yield* batches;
}

describe('TypeOrmExpertDirectoryStore transaction contract', () => {
	it('publishes a full initial snapshot atomically and replays without writes', async () => {
		const { store, manager, transaction } = transactionFixture();
		const checkpoint = { ...nextCheckpoint, previousCommit: null };
		const entry = { ...active, commit: checkpoint.commit, observedAt: checkpoint.observedAt };
		manager.findOneBy.mockResolvedValue(null);
		manager.findOne.mockResolvedValue(null);
		await expect(store.publishSnapshot(checkpoint, snapshotBatches([entry], [entry]))).resolves.toEqual({
			status: 'initialized', checkpoint
		});
		expect(transaction).toHaveBeenCalledWith('SERIALIZABLE', expect.any(Function));
		expect(manager.insert.mock.calls.map(([schema]) => schema)).toEqual([
			ExpertDirectoryEntrySchema, ExpertDirectoryEntrySchema, ExpertDirectoryCheckpointSchema
		]);
		manager.insert.mockClear();
		manager.findOne.mockResolvedValue({ source, ...checkpoint });
		await expect(store.publishSnapshot(checkpoint, snapshotBatches([entry]))).resolves.toMatchObject({
			status: 'replayed', checkpoint
		});
		expect(manager.insert).not.toHaveBeenCalled();
		await expect(store.publishSnapshot({ ...checkpoint, commit: 'f'.repeat(40) }, snapshotBatches()))
			.rejects.toThrow('base does not match');
	});
	it('locks the expected checkpoint and tombstones removed entries before publishing a refresh', async () => {
		const { store, manager, transaction } = transactionFixture(1);
		const address = 'GA2VRL65L3ZFEDDJ357RGI3MAOKPJZ2Z3IJTPSC24I4KDTNFSVEQURRA';
		const added = {
			...active, address, sourcePath: `accounts/${address}.json`,
			commit: nextCheckpoint.commit, observedAt: nextCheckpoint.observedAt
		};
		const query = {
			where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
			orderBy: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(),
			getMany: jest.fn(async () => [{ source, address: active.address, evidence: active }])
		};
		Object.assign(manager, { createQueryBuilder: jest.fn(() => query) });
		manager.findOne.mockResolvedValue({ source, commit: baseCommit });
		await expect(store.publishSnapshot(nextCheckpoint, snapshotBatches([added]))).resolves.toEqual({
			status: 'refreshed', checkpoint: nextCheckpoint
		});
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(manager.findOne).toHaveBeenCalledWith(ExpertDirectoryCheckpointSchema,
			{ where: { source }, lock: { mode: 'pessimistic_write' } });
		expect(manager.upsert).toHaveBeenLastCalledWith(ExpertDirectoryEntrySchema,
			[{ source, address: active.address, evidence: tombstone }], ['source', 'address']);
		expect(manager.upsert.mock.invocationCallOrder[1]).toBeLessThan(manager.update.mock.invocationCallOrder[0]!);
	});

	it('rejects the transaction when the stage fails after a batch was written', async () => {
		const { store, manager } = transactionFixture(1);
		manager.findOne.mockResolvedValue({ source, commit: baseCommit });
		async function* interruptedStage() {
			yield [{ ...active, commit: nextCheckpoint.commit, observedAt: nextCheckpoint.observedAt }];
			throw new Error('staging digest mismatch');
		}
		await expect(store.publishSnapshot(nextCheckpoint, interruptedStage())).rejects.toThrow('staging digest mismatch');
		expect(manager.upsert).toHaveBeenCalledTimes(1);
		expect(manager.update).not.toHaveBeenCalled();
	});
	it('builds the PostgreSQL checkpoint update without setting the source key', async () => {
		class OfflineDataSource extends DataSource {
			loadMetadata() {
				return this.buildMetadatas();
			}
		}
		const dataSource = new OfflineDataSource({
			type: 'postgres',
			entities: [ExpertDirectoryEntrySchema, ExpertDirectoryCheckpointSchema]
		});
		await dataSource.loadMetadata();

		const entry = dataSource.getMetadata(ExpertDirectoryEntrySchema);
		expect(entry.primaryColumns.map((column) => column.databaseName)).toEqual([
			'source',
			'address'
		]);
		expect(entry.findColumnWithPropertyName('evidence')?.type).toBe('jsonb');
		const checkpoint = dataSource.getMetadata(ExpertDirectoryCheckpointSchema);
		expect(
			checkpoint.primaryColumns.map((column) => column.databaseName)
		).toEqual(['source']);
		const { manager, store } = transactionFixture(1, dataSource);
		const checkpointWithSource = {
			...nextCheckpoint,
			source: 'other-directory'
		};
		await store.transaction((tx) =>
			tx.advanceCheckpoint(source, baseCommit, checkpointWithSource)
		);
		expect(manager.update).toHaveBeenCalledTimes(1);
		const [target, condition, values] = manager.update.mock.calls[0]!;
		expect(target).toBe(ExpertDirectoryCheckpointSchema);
		const [sql, parameters] = dataSource
			.createQueryBuilder()
			.update(ExpertDirectoryCheckpointSchema)
			.set(values)
			.where(condition)
			.getQueryAndParameters();
		expect(sql.split(' WHERE ')[0]).toBe(
			'UPDATE "expert_directory_checkpoint" SET "commit" = $1, "observed_at" = $2, "previous_commit" = $3, "delta_sha256" = $4'
		);
		expect(sql).toContain('WHERE ("source" = $5 AND "commit" = $6)');
		expect(parameters).toEqual([
			nextCheckpoint.commit,
			nextCheckpoint.observedAt,
			nextCheckpoint.previousCommit,
			nextCheckpoint.deltaSha256,
			source,
			baseCommit
		]);
		expect(values).toEqual(nextCheckpoint);
	});

	it.each(['other-directory', undefined])(
		'rejects runtime source %s before reading or writing',
		async (value) => {
			const { manager, store } = transactionFixture(1);
			const invalidSource = value as typeof source;
			await expect(
				store.transaction((tx) => tx.readCheckpoint(invalidSource))
			).rejects.toThrow('Unexpected directory source');
			await expect(
				store.transaction((tx) => tx.readEntry(invalidSource, active.address))
			).rejects.toThrow('Unexpected directory source');
			await expect(
				store.transaction((tx) =>
					tx.writeEntry({ ...active, source: invalidSource })
				)
			).rejects.toThrow('Unexpected directory source');
			await expect(
				store.transaction((tx) =>
					tx.advanceCheckpoint(invalidSource, baseCommit, nextCheckpoint)
				)
			).rejects.toThrow('Unexpected directory source');
			expect(manager.findOneBy).not.toHaveBeenCalled();
			expect(manager.findOne).not.toHaveBeenCalled();
			expect(manager.upsert).not.toHaveBeenCalled();
			expect(manager.update).not.toHaveBeenCalled();
		}
	);

	it('scopes reads and upserts by source and address on the callback manager', async () => {
		const { manager, store, transaction } = transactionFixture(1);
		manager.findOne.mockResolvedValueOnce({ source, ...nextCheckpoint });
		manager.findOneBy
			.mockResolvedValueOnce({
				source,
				address: active.address,
				evidence: active
			})
			.mockResolvedValueOnce(null);

		const result = await store.transaction(async (tx) => {
			expect(await tx.readCheckpoint(source)).toEqual(nextCheckpoint);
			expect(await tx.readEntry(source, active.address)).toEqual(active);
			expect(await tx.readEntry(source, 'absent')).toBeNull();
			await tx.writeEntry(active);
			await tx.writeEntry(tombstone);
			await tx.advanceCheckpoint(source, baseCommit, nextCheckpoint);
			return 'applied';
		});

		expect(result).toBe('applied');
		expect(transaction).toHaveBeenCalledTimes(1);
		expect(transaction).toHaveBeenCalledWith(
			'READ COMMITTED',
			expect.any(Function)
		);
		expect(manager.findOne).toHaveBeenCalledWith(ExpertDirectoryCheckpointSchema,
			{ where: { source }, lock: { mode: 'pessimistic_write' } });
		expect(manager.findOneBy.mock.calls).toEqual([
			[ExpertDirectoryEntrySchema, { source, address: active.address }],
			[ExpertDirectoryEntrySchema, { source, address: 'absent' }]
		]);
		expect(manager.upsert.mock.calls).toEqual([
			[
				ExpertDirectoryEntrySchema,
				{ source, address: active.address, evidence: active },
				['source', 'address']
			],
			[
				ExpertDirectoryEntrySchema,
				{ source, address: active.address, evidence: tombstone },
				['source', 'address']
			]
		]);
		expect(manager.update.mock.calls).toEqual([
			[
				ExpertDirectoryCheckpointSchema,
				{ source, commit: baseCommit },
				nextCheckpoint
			]
		]);
		expect(manager.upsert.mock.invocationCallOrder[1]).toBeLessThan(
			manager.update.mock.invocationCallOrder[0]!
		);
	});

	it.each([0, 2, undefined])(
		'rejects the transaction callback after staging with %s affected checkpoint rows',
		async (affected) => {
			const { manager, store, transaction } = transactionFixture(affected);
			await expect(
				store.transaction(async (tx) => {
					await tx.writeEntry(tombstone);
					await tx.advanceCheckpoint(source, baseCommit, nextCheckpoint);
				})
			).rejects.toThrow('Directory checkpoint changed during import');
			expect(manager.upsert).toHaveBeenCalledTimes(1);
			expect(manager.update).toHaveBeenCalledTimes(1);
			await expect(transaction.mock.results[0]?.value).rejects.toThrow(
				'Directory checkpoint changed during import'
			);
		}
	);

	it('rejects staged writes when the callback never advances the checkpoint', async () => {
		const { store } = transactionFixture();
		await expect(
			store.transaction((tx) => tx.writeEntry(active))
		).rejects.toThrow(
			'Directory transaction requires a successful checkpoint advance'
		);
	});

	it('rejects a transaction even if the callback catches a failed checkpoint update', async () => {
		const { store } = transactionFixture(0);
		await expect(
			store.transaction(async (tx) => {
				await tx.writeEntry(active);
				await expect(
					tx.advanceCheckpoint(source, baseCommit, nextCheckpoint)
				).rejects.toThrow('Directory checkpoint changed during import');
			})
		).rejects.toThrow(
			'Directory transaction requires a successful checkpoint advance'
		);
	});

	it('allows a read-only transaction and an advancement without entry writes', async () => {
		const { manager, store } = transactionFixture(1);
		manager.findOne.mockResolvedValueOnce(null);
		await expect(
			store.transaction((tx) => tx.readCheckpoint(source))
		).resolves.toBeNull();
		expect(manager.update).not.toHaveBeenCalled();
		await store.transaction((tx) =>
			tx.advanceCheckpoint(source, baseCommit, nextCheckpoint)
		);
		expect(manager.update).toHaveBeenCalledTimes(1);
		expect(manager.upsert).not.toHaveBeenCalled();
	});
});
