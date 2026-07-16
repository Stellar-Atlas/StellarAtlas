import { DataSource, type QueryRunner } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { historyArchiveObjectStaleReleaseSql } from '../HistoryArchiveObjectLeaseWrite.js';

jest.setTimeout(120_000);

describe('HistoryArchiveObjectLeaseWrite integration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [],
			logging: false,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('skips stale scanning rows while another process owns maintenance', async () => {
		const remoteId = '00000000-0000-4000-8000-000000000001';
		await dataSource.query(
			`insert into history_archive_object_queue (
				"remoteId", status, "updatedAt"
			) values ($1, 'scanning', '2026-01-01T00:00:00.000Z')`,
			[remoteId]
		);
		await dataSource.query(
			`insert into history_archive_object_claim_slot (
				slot, "objectRemoteId", "updatedAt"
			) values (0, $1, now())`,
			[remoteId]
		);

		const owner = await acquireMaintenanceLock(dataSource);
		try {
			expect(await releaseStale(dataSource)).toEqual([]);
			expect(await objectStatus(dataSource, remoteId)).toBe('scanning');
		} finally {
			await owner.rollbackTransaction();
			await owner.release();
		}

		expect(await releaseStale(dataSource)).toHaveLength(1);
		expect(await objectStatus(dataSource, remoteId)).toBe('pending');
	});
});

async function createSchema(dataSource: DataSource): Promise<void> {
	await dataSource.query(`
		create table history_archive_object_queue (
			id bigserial primary key,
			"remoteId" uuid not null unique,
			status text not null,
			"claimedAt" timestamptz,
			"claimedByCommunityScannerId" uuid,
			"workerStage" text,
			"updatedAt" timestamptz not null
		)
	`);
	await dataSource.query(`
		create table history_archive_object_claim_slot (
			slot integer primary key,
			"objectRemoteId" uuid,
			"claimedAt" timestamptz,
			"updatedAt" timestamptz not null
		)
	`);
}

async function acquireMaintenanceLock(
	dataSource: DataSource
): Promise<QueryRunner> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	await runner.startTransaction();
	await runner.query(
		`select pg_advisory_xact_lock(
			hashtext('history_archive_object_stale_release')
		)`
	);
	return runner;
}

async function releaseStale(
	dataSource: DataSource
): Promise<readonly Readonly<Record<string, unknown>>[]> {
	return await dataSource.transaction(async (manager) => {
		const result: unknown = await manager.query(
			historyArchiveObjectStaleReleaseSql,
			[new Date('2026-01-02T00:00:00.000Z'), 24]
		);
		if (!Array.isArray(result)) throw new Error('Expected released rows');
		return result.filter(isRecord);
	});
}

async function objectStatus(
	dataSource: DataSource,
	remoteId: string
): Promise<string> {
	const result: unknown = await dataSource.query(
		`select status from history_archive_object_queue where "remoteId" = $1`,
		[remoteId]
	);
	if (!Array.isArray(result) || !isRecord(result[0])) {
		throw new Error('Expected archive object status');
	}
	const status = result[0].status;
	if (typeof status !== 'string') throw new Error('Expected string status');
	return status;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
