import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import { DirectoryReader } from '../DirectoryReader.js';
import {
	applyExpertDirectoryDelta,
	type ExpertDirectoryChange,
	type ExpertDirectoryDelta,
	type ExpertDirectoryStore
} from '../ExpertDirectoryImport.js';
import { EXPERT_DIRECTORY_SOURCE as source, parseExpertDirectoryRecord } from '../ExpertDirectoryRecord.js';
import { TypeOrmDirectoryReader } from '../TypeOrmDirectoryReader.js';
import {
	ExpertDirectoryCheckpointSchema,
	ExpertDirectoryEntrySchema,
	TypeOrmExpertDirectoryStore
} from '../TypeOrmExpertDirectoryStore.js';

const marker = process.env.IDENTITY_DIRECTORY_FIXTURE;
const fixture = marker === undefined ? describe.skip : describe;
const initial = 'a'.repeat(40);
const first = 'b'.repeat(40);
const second = 'c'.repeat(40);
const third = 'd'.repeat(40);
const observedAt = '2026-11-04T20:30:00.000Z';
const foreign = 'fixture/other-source';
const history = { isAncestor: async () => true };
const address = (seed: number) =>
	StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
const path = (key: string) => `accounts/${key}.json`;

function upsert(key: string, name: string, domain = 'stellar.org') {
	const bytes = Buffer.from(
		JSON.stringify({ address: key, name, domain, tags: [], version: 1 })
	);
	const blobOid = createHash('sha1')
		.update(`blob ${bytes.length}\0`)
		.update(bytes)
		.digest('hex');
	return {
		kind: 'upsert',
		path: path(key),
		previousBlobOid: null,
		blobOid,
		bytes
	} as const;
}

function delta(
	fromCommit: string,
	toCommit: string,
	...changes: ExpertDirectoryChange[]
): ExpertDirectoryDelta {
	return { source, fromCommit, toCommit, complete: true, observedAt, changes };
}

async function openFixture(): Promise<DataSource> {
	const root = process.env.IDENTITY_DIRECTORY_FIXTURE_ROOT;
	const portText = process.env.IDENTITY_DIRECTORY_FIXTURE_PORT;
	const password = process.env.IDENTITY_DIRECTORY_FIXTURE_PASSWORD;
	if (
		process.platform !== 'win32' ||
		!marker ||
		!/^atlas-dir-[a-f0-9]{32}$/.test(marker) ||
		!root ||
		basename(root) !== marker ||
		!portText ||
		!/^\d{5}$/.test(portText) ||
		Number(portText) < 49152 ||
		Number(portText) > 65535 ||
		!password ||
		!/^[a-f0-9]{64}$/.test(password)
	)
		throw new Error(
			'A verified disposable Windows PostgreSQL fixture is required'
		);
	const dataPath = realpathSync(resolve(root, 'data'));
	const dataSource = new DataSource({
		type: 'postgres',
		host: '127.0.0.1',
		port: Number(portText),
		username: 'directory_fixture',
		password,
		database: 'postgres',
		ssl: false,
		installExtensions: false,
		poolSize: 2,
		connectTimeoutMS: 3000,
		extra: {
			options:
				'-c statement_timeout=6000 -c lock_timeout=4000 -c idle_in_transaction_session_timeout=8000'
		},
		entities: [ExpertDirectoryCheckpointSchema, ExpertDirectoryEntrySchema]
	});
	try {
		await dataSource.initialize();
		const [server] = await dataSource.query(`
			SELECT current_setting('cluster_name') AS marker,
				current_setting('data_directory') AS data_path,
				current_setting('listen_addresses') AS listen_addresses,
				current_setting('server_version_num') AS version_num,
				current_setting('fsync') AS fsync,
				host(inet_server_addr()) AS host, inet_server_port() AS port,
				current_database() AS database, current_user AS username
		`);
		if (
			server?.marker !== marker ||
			realpathSync(server.data_path) !== dataPath ||
			server.listen_addresses !== '127.0.0.1' ||
			server.host !== '127.0.0.1' ||
			server.port !== Number(portText) ||
			server.database !== 'postgres' ||
			server.username !== 'directory_fixture' ||
			server.fsync !== 'on' ||
			!/^16\d{4}$/.test(server.version_num)
		)
			throw new Error(
				'PostgreSQL server identity did not match the disposable fixture'
			);
		return dataSource;
	} catch (error) {
		if (dataSource.isInitialized) await dataSource.destroy();
		throw error;
	}
}

fixture('native PostgreSQL account directory', () => {
	let dataSource: DataSource;
	const store = () => new TypeOrmExpertDirectoryStore(dataSource);

	beforeAll(async () => {
		dataSource = await openFixture();
		await dataSource.synchronize();
	}, 20_000);

	beforeEach(async () => {
		await dataSource.manager.clear(ExpertDirectoryEntrySchema);
		await dataSource.manager.clear(ExpertDirectoryCheckpointSchema);
		await dataSource.manager.insert(ExpertDirectoryCheckpointSchema, {
			source,
			commit: initial,
			observedAt,
			previousCommit: null,
			deltaSha256: null
		});
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
	});

	it('rolls back an inserted row, staged tombstone and successful checkpoint update together', async () => {
		const original = upsert(address(1), 'Original');
		await applyExpertDirectoryDelta(
			delta(initial, first, original),
			history,
			store()
		);
		const failure: ExpertDirectoryStore = {
			transaction: (work) =>
				store().transaction(async (tx) => {
					await work(tx);
					expect((await tx.readEntry(source, address(1)))?.state).toBe(
						'deleted'
					);
					expect((await tx.readEntry(source, address(2)))?.state).toBe(
						'active'
					);
					expect((await tx.readCheckpoint(source))?.commit).toBe(second);
					throw new Error('Forced failure after checkpoint advancement');
				})
		};
		await expect(
			applyExpertDirectoryDelta(
				delta(
					first,
					second,
					{
						kind: 'delete',
						path: original.path,
						previousBlobOid: original.blobOid
					},
					upsert(address(2), 'Staged')
				),
				history,
				failure
			)
		).rejects.toThrow('Forced failure after checkpoint advancement');

		await store().transaction(async (tx) => {
			expect(await tx.readCheckpoint(source)).toMatchObject({
				commit: first,
				previousCommit: initial
			});
			expect(await tx.readEntry(source, address(1))).toMatchObject({
				state: 'active',
				sourceBlobOid: original.blobOid
			});
			expect(await tx.readEntry(source, address(2))).toBeNull();
		});
	}, 15_000);

	it('serializes simultaneous writers before allowing one successor', async () => {
		const other = await openFixture();
		const left = address(3);
		const right = address(4);
		try {
			const results = await Promise.allSettled([
				applyExpertDirectoryDelta(
					delta(initial, first, upsert(left, 'Left')),
					history,
					store()
				),
				applyExpertDirectoryDelta(
					delta(initial, second, upsert(right, 'Right')),
					history,
					new TypeOrmExpertDirectoryStore(other)
				)
			]);
			expect(
				results.filter((result) => result.status === 'fulfilled')
			).toHaveLength(1);
			const leftWon = results[0]?.status === 'fulfilled';
			const loser = results[leftWon ? 1 : 0];
			expect(loser).toMatchObject({
				status: 'rejected',
				reason: expect.objectContaining({
					message: 'Directory checkpoint does not match the delta base'
				})
			});
			await store().transaction(async (tx) => {
				expect((await tx.readCheckpoint(source))?.commit).toBe(
					leftWon ? first : second
				);
				expect(
					await tx.readEntry(source, leftWon ? left : right)
				).toMatchObject({ state: 'active' });
				expect(await tx.readEntry(source, leftWon ? right : left)).toBeNull();
			});
		} finally {
			await other.destroy();
		}
	}, 15_000);

	it('keeps the previous view during refresh and rolls back a failed staged batch', async () => {
		const removed = address(1);
		const added = address(2);
		const original = upsert(removed, 'Original');
		await applyExpertDirectoryDelta(delta(initial, first, original), history, store());
		const checkpoint = { commit: second, previousCommit: first, observedAt, deltaSha256: 'e'.repeat(64) };
		const replacement = upsert(added, 'Replacement');
		const entry = {
			...parseExpertDirectoryRecord(replacement.path, replacement.blobOid, replacement.bytes),
			commit: second, observedAt, state: 'active' as const
		};
		const reader = new TypeOrmDirectoryReader(dataSource);
		async function* stage(fail: boolean) {
			yield [entry];
			expect(await reader.lookup(removed)).toMatchObject({
				checkpoint: { commit: first },
				entries: [{ state: 'active', name: 'Original' }]
			});
			expect(await reader.lookup(added)).toMatchObject({
				checkpoint: { commit: first }, entries: []
			});
			if (fail) throw new Error('Interrupted snapshot stage');
		}
		await expect(store().publishSnapshot(checkpoint, stage(true))).rejects.toThrow('Interrupted snapshot stage');
		expect(await reader.lookup(added)).toMatchObject({ checkpoint: { commit: first }, entries: [] });
		await expect(store().publishSnapshot(checkpoint, stage(false))).resolves.toEqual({
			status: 'refreshed', checkpoint
		});
		expect(await reader.lookup(removed)).toMatchObject({
			checkpoint, entries: [{ state: 'deleted', previousBlobOid: original.blobOid }]
		});
		expect(await reader.lookup(added)).toMatchObject({
			checkpoint, entries: [{ state: 'active', name: 'Replacement' }]
		});
		await expect(store().publishSnapshot(checkpoint, stage(false))).resolves.toMatchObject({
			status: 'replayed', checkpoint
		});
	}, 15_000);

	it('replays the exact checkpoint after reconnecting and performs no replay writes', async () => {
		const key = address(5);
		const change = delta(initial, third, upsert(key, 'Replay'));
		const applied = await applyExpertDirectoryDelta(change, history, store());
		const prior = await store().transaction((tx) => tx.readEntry(source, key));
		await dataSource.destroy();
		dataSource = await openFixture();
		const rejectWrite = async () => {
			throw new Error('Replay tried to write');
		};
		const readOnlyReplay: ExpertDirectoryStore = {
			transaction: (work) =>
				store().transaction((tx) =>
					work({
						...tx,
						writeEntry: rejectWrite,
						advanceCheckpoint: rejectWrite
					})
				)
		};
		await expect(
			applyExpertDirectoryDelta(change, history, readOnlyReplay)
		).resolves.toEqual({
			status: 'replayed',
			checkpoint: applied.checkpoint
		});
		expect(
			await store().transaction((tx) => tx.readEntry(source, key))
		).toEqual(prior);
	}, 15_000);

	it('executes reader SQL and keeps imported source and Atlas networks isolated', async () => {
		const key = address(6);
		const removed = address(7);
		const former = upsert(removed, 'Example Former');
		await applyExpertDirectoryDelta(
			delta(initial, first, upsert(key, 'Example Expert'), former),
			history,
			store()
		);
		await applyExpertDirectoryDelta(
			delta(first, second, {
				kind: 'delete',
				path: former.path,
				previousBlobOid: former.blobOid
			}),
			history,
			store()
		);
		await dataSource.query(
			'INSERT INTO expert_directory_entry (source,address,evidence) VALUES ($1,$2,$3::jsonb)',
			[
				foreign,
				address(8),
				JSON.stringify({
					state: 'active',
					name: 'Example Foreign',
					address: address(8)
				})
			]
		);
		await dataSource.query(
			'INSERT INTO expert_directory_checkpoint (source,commit,observed_at) VALUES ($1,$2,$3)',
			[foreign, third, observedAt]
		);
		const reader = new DirectoryReader(new TypeOrmDirectoryReader(dataSource), [
			{
				network: 'mainnet',
				address: key,
				name: 'Example Atlas',
				tags: [],
				revision: 2,
				observedAt
			},
			{
				network: 'mainnet',
				address: removed,
				name: 'Example Overlay',
				tags: [],
				revision: 1,
				observedAt
			},
			{
				network: 'testnet',
				address: key,
				name: 'Testnet Alias',
				tags: [],
				revision: 1,
				observedAt
			}
		]);
		const main = await reader.search('mainnet', 'EXAMPLE', undefined, '1');
		expect(main.items).toHaveLength(1);
		expect(main.nextCursor).toBe(main.items[0]?.address);
		expect(main.upstream).toMatchObject({
			source,
			checkpoint: { commit: second }
		});
		const next = await reader.search(
			'mainnet',
			'example',
			main.nextCursor,
			'1'
		);
		expect(next.nextCursor).toBeNull();
		const all = [...main.items, ...next.items];
		expect(all.find((entry) => entry.address === key)).toMatchObject({
			imported: { name: 'Example Expert' },
			atlas: { name: 'Example Atlas' },
			conflicts: ['name']
		});
		expect(all.find((entry) => entry.address === removed)).toMatchObject({
			imported: { state: 'deleted' },
			atlas: { name: 'Example Overlay' }
		});
		const testnet = await reader.search(
			'testnet',
			'example',
			undefined,
			undefined
		);
		expect(testnet.items.map((entry) => entry.address)).toEqual([key]);
		expect(testnet.items[0]?.atlas?.name).toBe('Testnet Alias');
		expect(
			(await reader.lookup('testnet', address(8))).evidence.imported
		).toBeNull();
		expect(
			(await reader.lookup('mainnet', key)).evidence.imported
		).toMatchObject({ name: 'Example Expert' });
		expect(
			(await reader.search('mainnet', "exa_%' OR true", undefined, undefined))
				.items
		).toEqual([]);
	}, 15_000);
});
