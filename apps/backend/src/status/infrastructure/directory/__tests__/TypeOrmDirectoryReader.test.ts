import { DataSource, type EntityManager } from 'typeorm';
import { EXPERT_DIRECTORY_SOURCE } from '../ExpertDirectoryRecord.js';
import { TypeOrmDirectoryReader } from '../TypeOrmDirectoryReader.js';
import {
	ExpertDirectoryCheckpointSchema,
	ExpertDirectoryEntrySchema
} from '../TypeOrmExpertDirectoryStore.js';

const checkpoint = {
	source: EXPERT_DIRECTORY_SOURCE,
	commit: 'a'.repeat(40),
	observedAt: '2026-11-04T20:30:00.000Z',
	previousCommit: null,
	deltaSha256: null
};
const address = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

async function fixture(initialized = true) {
	class OfflineDataSource extends DataSource {
		loadMetadata() {
			return this.buildMetadatas();
		}
	}
	const dataSource = new OfflineDataSource({
		type: 'postgres',
		entities: [ExpertDirectoryCheckpointSchema, ExpertDirectoryEntrySchema]
	});
	await dataSource.loadMetadata();
	const builder = dataSource.createQueryBuilder(
		ExpertDirectoryEntrySchema,
		'entry'
	);
	jest.spyOn(builder, 'getMany').mockResolvedValue([]);
	const manager = {
		query: jest.fn(),
		findOneBy: jest.fn().mockResolvedValue(initialized ? checkpoint : null),
		createQueryBuilder: jest.fn().mockReturnValue(builder)
	};
	const transaction = jest
		.spyOn(dataSource, 'transaction')
		.mockImplementation(async (_isolation, work) =>
			work(manager as unknown as EntityManager)
		);
	return {
		reader: new TypeOrmDirectoryReader(dataSource),
		builder,
		manager,
		transaction
	};
}

it('builds a bounded source-scoped prefix search inside a read-only snapshot', async () => {
	const { reader, builder, manager, transaction } = await fixture();
	const prefix = "x_%' OR true";
	await expect(
		reader.search({
			prefix,
			after: address,
			take: 51,
			atlasAddresses: [address]
		})
	).resolves.toEqual({ checkpoint, entries: [] });
	expect(transaction).toHaveBeenCalledWith(
		'REPEATABLE READ',
		expect.any(Function)
	);
	expect(manager.query.mock.calls).toEqual([
		['SET TRANSACTION READ ONLY'],
		[
			expect.stringContaining("set_config('statement_timeout'"),
			['1000ms', '250ms']
		]
	]);
	expect(manager.findOneBy).toHaveBeenCalledWith(
		ExpertDirectoryCheckpointSchema,
		{ source: EXPERT_DIRECTORY_SOURCE }
	);
	expect(manager.createQueryBuilder).toHaveBeenCalledWith(
		ExpertDirectoryEntrySchema,
		'entry'
	);
	const [sql, parameters] = builder.getQueryAndParameters();
	expect(sql).toContain(
		'WHERE "entry"."source" = $1 AND "entry"."address" COLLATE "C" > $2'
	);
	expect(sql).toContain("evidence->>'state' = 'active'");
	expect(sql).toContain('OR "entry"."address" IN (');
	expect(sql).toContain('ORDER BY "entry"."address" COLLATE "C" ASC LIMIT 51');
	expect(sql).not.toContain(prefix);
	expect(parameters).toEqual(
		expect.arrayContaining([EXPERT_DIRECTORY_SOURCE, address, prefix])
	);
});

it('reads exact entries by source and address and skips reads without an import checkpoint', async () => {
	const { reader, manager } = await fixture();
	manager.findOneBy
		.mockResolvedValueOnce(checkpoint)
		.mockResolvedValueOnce(null);
	await expect(reader.lookup(address)).resolves.toEqual({
		checkpoint,
		entries: []
	});
	expect(manager.findOneBy.mock.calls).toEqual([
		[ExpertDirectoryCheckpointSchema, { source: EXPERT_DIRECTORY_SOURCE }],
		[ExpertDirectoryEntrySchema, { source: EXPERT_DIRECTORY_SOURCE, address }]
	]);
	const empty = await fixture(false);
	await expect(empty.reader.lookup(address)).resolves.toEqual({
		checkpoint: null,
		entries: []
	});
	await expect(
		empty.reader.search({
			prefix: 'atlas',
			after: '',
			take: 21,
			atlasAddresses: []
		})
	).resolves.toEqual({ checkpoint: null, entries: [] });
	expect(empty.manager.findOneBy.mock.calls).toEqual([
		[ExpertDirectoryCheckpointSchema, { source: EXPERT_DIRECTORY_SOURCE }],
		[ExpertDirectoryCheckpointSchema, { source: EXPERT_DIRECTORY_SOURCE }]
	]);
	expect(empty.manager.createQueryBuilder).not.toHaveBeenCalled();
});
