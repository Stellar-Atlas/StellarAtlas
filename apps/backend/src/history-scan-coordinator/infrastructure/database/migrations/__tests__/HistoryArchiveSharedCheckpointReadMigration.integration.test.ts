import { DataSource } from 'typeorm';
import { HistoryArchiveSharedCheckpointReadMigration1788496000000 } from '../1788496000000-HistoryArchiveSharedCheckpointReadMigration.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(60_000);

describe('shared checkpoint dependency read migration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
		await dataSource.query(`
			create table history_archive_object_queue (
				"remoteId" uuid primary key,
				"dependenciesMaterializedAt" timestamptz,
				"verifiedAt" timestamptz
			);
			create table history_archive_checkpoint_bucket_dependency (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"bucketHash" text not null,
				"createdAt" timestamptz not null default now(),
				primary key ("archiveUrlIdentity", "checkpointLedger", "bucketHash")
			);
			create table history_archive_checkpoint_bucket_set (
				"bucketSetDigest" text primary key
			);
			create table history_archive_checkpoint_bucket_set_member (
				"bucketSetDigest" text not null,
				"bucketHash" text not null,
				primary key ("bucketSetDigest", "bucketHash")
			);
			create table history_archive_checkpoint_content (
				"contentDigest" text primary key,
				"bucketSetDigest" text not null
			);
			create table history_archive_checkpoint_content_observation (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"contentDigest" text not null,
				"checkpointStateObjectRemoteId" uuid not null,
				"createdAt" timestamptz not null default now(),
				primary key ("archiveUrlIdentity", "checkpointLedger")
			)
		`);
		const runner = dataSource.createQueryRunner();
		await new HistoryArchiveSharedCheckpointReadMigration1788496000000().up(
			runner
		);
		await runner.release();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('prefers shared membership and preserves legacy-only checkpoints', async () => {
		const root = 'https://shared.example/archive';
		const legacyRoot = 'https://legacy.example/archive';
		const remoteId = '11111111-1111-4111-8111-111111111111';
		const materializedAt = '2026-08-01T12:00:00.000Z';
		await dataSource.query(
			`insert into history_archive_object_queue values ($1, $2, $2)`,
			[remoteId, materializedAt]
		);
		await dataSource.query(
			`insert into history_archive_checkpoint_bucket_set values ('set')`
		);
		await dataSource.query(
			`insert into history_archive_checkpoint_bucket_set_member
			 values ('set', 'shared-hash')`
		);
		await dataSource.query(
			`insert into history_archive_checkpoint_content
			 values ('content', 'set')`
		);
		await dataSource.query(
			`insert into history_archive_checkpoint_content_observation
			 values ($1, 63, 'content', $2, now())`,
			[root, remoteId]
		);
		await dataSource.query(
			`insert into history_archive_checkpoint_bucket_dependency values
			 ($1, 63, 'obsolete-legacy-hash', now()),
			 ($2, 127, 'legacy-only-hash', now())`,
			[root, legacyRoot]
		);

		const rows = (await dataSource.query(`
			select "archiveUrlIdentity", "checkpointLedger", "bucketHash",
				"createdAt"
			from history_archive_checkpoint_bucket_dependency_current
			order by "archiveUrlIdentity", "checkpointLedger", "bucketHash"
		`)) as readonly {
			readonly archiveUrlIdentity: string;
			readonly bucketHash: string;
			readonly checkpointLedger: number;
			readonly createdAt: Date;
		}[];

		expect(rows).toHaveLength(2);
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					archiveUrlIdentity: root,
					bucketHash: 'shared-hash',
					checkpointLedger: 63,
					createdAt: new Date(materializedAt)
				}),
				expect.objectContaining({
					archiveUrlIdentity: legacyRoot,
					bucketHash: 'legacy-only-hash',
					checkpointLedger: 127
				})
			])
		);
		expect(rows).not.toContainEqual(
			expect.objectContaining({ bucketHash: 'obsolete-legacy-hash' })
		);
	});
});
