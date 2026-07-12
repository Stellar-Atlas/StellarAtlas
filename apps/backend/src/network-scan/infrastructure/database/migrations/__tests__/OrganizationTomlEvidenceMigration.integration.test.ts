import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { OrganizationTomlEvidenceMigration1784795000000 } from '../1784795000000-OrganizationTomlEvidenceMigration.js';
import {
	estimateOrganizationTomlBackfillPeakBytes,
	ORGANIZATION_TOML_BACKFILL_DISK_RESERVE_BYTES,
	OrganizationTomlEvidenceBackfill
} from '../OrganizationTomlEvidenceBackfill.js';

const GIBIBYTE = 1_024n * 1_024n * 1_024n;
const SAFE_AVAILABLE_BYTES = 17n * GIBIBYTE;

interface MeasurementStorageRow {
	readonly ctid: string;
	readonly organizationId: number;
	readonly time: Date;
	readonly xmin: string;
}

interface RelationStorage {
	readonly bytes: string;
	readonly fileNode: string;
}

jest.setTimeout(120_000);

describe('Organization TOML online migration PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let measurementRelationBefore: RelationStorage;
	let measurementStorageBefore: MeasurementStorageRow[];

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			logging: false,
			migrations: [OrganizationTomlEvidenceMigration1784795000000],
			migrationsRun: false,
			migrationsTransactionMode: 'each',
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await createProductionShapedLegacyTables();
		measurementRelationBefore = await readMeasurementRelation();
		measurementStorageBefore = await readMeasurementStorage();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('times out under lock contention and safely retries the nontransactional up', async () => {
		expect(dataSource.options.migrationsRun).toBe(false);
		expect(dataSource.options.migrationsTransactionMode).toBe('each');
		const blocker = dataSource.createQueryRunner();
		await blocker.connect();
		await blocker.startTransaction();
		await blocker.query(
			`lock table "organization_measurement" in access exclusive mode`
		);
		try {
			await expect(dataSource.runMigrations()).rejects.toThrow(/lock timeout/i);
		} finally {
			await blocker.rollbackTransaction();
			await blocker.release();
		}

		await expect(dataSource.runMigrations()).resolves.toHaveLength(1);
		await expect(dataSource.runMigrations()).resolves.toHaveLength(0);
	});

	it('preserves the production heap and primary-key order through up', async () => {
		const primaryKey = (await dataSource.query(`
			select pg_get_constraintdef(oid) as definition
			from pg_constraint
			where conrelid = 'organization_measurement'::regclass and contype = 'p'
		`)) as Array<{ definition: string }>;

		expect(primaryKey[0]?.definition).toBe(
			'PRIMARY KEY ("time", "organizationId")'
		);
		expect(await readMeasurementRelation()).toEqual(measurementRelationBefore);
		expect(await readMeasurementStorage()).toEqual(measurementStorageBefore);
		const columns = await measurementEvidenceColumns();
		expect(columns).toEqual([
			{ columnName: 'scanRunId', isNullable: 'YES' },
			{ columnName: 'tomlEvidenceSequence', isNullable: 'YES' },
			{ columnName: 'tomlFetchResult', isNullable: 'YES' }
		]);
	});

	it('quarantines malformed rows, advances its cursor, and never rewrites measurements', async () => {
		const backfill = new OrganizationTomlEvidenceBackfill(1);
		const peakEstimate = estimateOrganizationTomlBackfillPeakBytes(1);
		const insufficient =
			ORGANIZATION_TOML_BACKFILL_DISK_RESERVE_BYTES + peakEstimate - 1n;
		await expect(
			backfill.runBatch(dataSource, { availableBytes: insufficient })
		).resolves.toMatchObject({
			insertedAttempts: 0,
			pauseReason: 'insufficient_disk',
			processedOrganizations: 0,
			quarantinedRows: 0
		});

		const walBefore = await currentWalLsn();
		const batches = [];
		for (let index = 0; index < 5; index++) {
			batches.push(
				await backfill.runBatch(dataSource, {
					availableBytes: SAFE_AVAILABLE_BYTES
				})
			);
		}
		expect(batches).toMatchObject([
			{ completed: false, insertedAttempts: 2, quarantinedRows: 0 },
			{ completed: false, insertedAttempts: 0, quarantinedRows: 0 },
			{ completed: false, insertedAttempts: 0, quarantinedRows: 1 },
			{ completed: false, insertedAttempts: 1, quarantinedRows: 0 },
			{ completed: true, insertedAttempts: 0, quarantinedRows: 0 }
		]);

		const attempts = (await dataSource.query(
			`select "result", "authoritative", "contentHash", "source"
			 from "organization_toml_attempt" order by "observedAt"`
		)) as Array<Record<string, unknown>>;
		const [snapshot] = (await dataSource.query(
			`select "latestAttemptResult", "latestFailureState",
				"latestInsecureState", "latestSuccessObservedAt"
			 from "organization_toml_snapshot" where "organizationId" = 1`
		)) as Array<Record<string, unknown>>;
		const [progress] = (await dataSource.query(
			`select "completed", "lastOrganizationId"
			 from "organization_toml_backfill_progress"`
		)) as Array<Record<string, unknown>>;
		const quarantine = (await dataSource.query(
			`select "organizationId", "measurementTime", "reasonCode", "occurrences"
			 from "organization_toml_backfill_quarantine"`
		)) as Array<Record<string, unknown>>;

		expect(attempts).toHaveLength(3);
		expect(attempts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					authoritative: false,
					contentHash: null,
					source: 'legacy_backfill'
				})
			])
		);
		expect(snapshot).toMatchObject({
			latestAttemptResult: 'failure',
			latestFailureState: 'ParsingError',
			latestInsecureState: 'Ok',
			latestSuccessObservedAt: null
		});
		expect(progress).toEqual({ completed: true, lastOrganizationId: 4 });
		expect(quarantine).toEqual([
			expect.objectContaining({
				occurrences: 1,
				organizationId: 3,
				reasonCode: 'invalid_warnings'
			})
		]);
		expect(await readMeasurementStorage()).toEqual(measurementStorageBefore);
		expect(await readMeasurementRelation()).toEqual(measurementRelationBefore);
		expect(await walBytesSince(walBefore)).toBeLessThan(peakEstimate);
		expect(await countRows('organization_toml_content')).toBe(0);
	});

	it('bounds quarantine storage and deduplicates repeated malformed identities', async () => {
		await dataSource.query(`
			insert into "organization" (id, "organizationIdValue") values
				(5, 'org-5'), (6, 'org-6'), (7, 'org-7');
			insert into "organization_measurement" (
				"time", "organizationId", "isSubQuorumAvailable", "index",
				"tomlState", "tomlWarnings"
			) values
				('2020-02-05', 5, false, 0, 'Ok', '{"bad":true}'::jsonb),
				('2020-02-06', 6, false, 0, 'Ok', '{"bad":true}'::jsonb),
				('2020-02-07', 7, false, 0, 'Ok', '{"bad":true}'::jsonb);
			update "organization_toml_backfill_progress"
			set "lastOrganizationId" = 4, "completed" = false;
		`);
		const backfill = new OrganizationTomlEvidenceBackfill(10, 2);
		await expect(
			backfill.runBatch(dataSource, { availableBytes: SAFE_AVAILABLE_BYTES })
		).resolves.toMatchObject({ completed: true, quarantinedRows: 3 });
		expect(await countRows('organization_toml_backfill_quarantine')).toBe(2);

		await dataSource.query(`
			update "organization_toml_backfill_progress"
			set "lastOrganizationId" = 4, "completed" = false
		`);
		await backfill.runBatch(dataSource, {
			availableBytes: SAFE_AVAILABLE_BYTES
		});
		const [quarantineFacts] = (await dataSource.query(`
			select count(*)::integer as count,
				count(distinct ("organizationId", "measurementTime", "reasonCode"))::integer
					as distinct_count,
				bool_and("reasonCode" in ('invalid_state', 'invalid_warnings')) as bounded_codes
			from "organization_toml_backfill_quarantine"
		`)) as Array<Record<string, unknown>>;
		expect(quarantineFacts).toEqual({
			bounded_codes: true,
			count: 2,
			distinct_count: 2
		});
	});

	it('rejects TLS evidence promotion in attempt and snapshot constraints', async () => {
		const hash = 'a'.repeat(64);
		await dataSource.query(
			`insert into "organization_toml_content" (
				"hash", "byteLength", "content"
			 ) values ($1, 15, 'VERSION="2.0.0"')`,
			[hash]
		);
		await expect(
			dataSource.query(
				`insert into "organization_toml_attempt" (
					"organizationId", "scanRunId", "observedAt", "result", "state",
					"warnings", "authoritative", "contentHash"
				 ) values (
					2, 'forged-authority', now(), 'success', 'Ok',
					'["TlsCertificateVerificationDisabled"]'::jsonb, true, $1
				 )`,
				[hash]
			)
		).rejects.toThrow('CHK_organization_toml_attempt_content');
	});

	it('runs the real down migration without touching legacy rows', async () => {
		const legacyRowsBeforeDown = await countRows('organization_measurement');
		await expect(dataSource.undoLastMigration()).resolves.toBeUndefined();

		const [relations] = (await dataSource.query(`
			select to_regclass('organization_toml_attempt') as attempt,
				to_regclass('organization_toml_snapshot') as snapshot,
				to_regclass('organization_toml_backfill_quarantine') as quarantine
		`)) as Array<Record<string, unknown>>;
		expect(relations).toEqual({
			attempt: null,
			quarantine: null,
			snapshot: null
		});
		expect(await measurementEvidenceColumns()).toEqual([]);
		expect(await countRows('organization_measurement')).toBe(
			legacyRowsBeforeDown
		);
	});

	async function countRows(table: string): Promise<number> {
		const [row] = (await dataSource.query(
			`select count(*)::integer as count from "${table}"`
		)) as Array<{ count: number }>;
		return row?.count ?? -1;
	}

	async function currentWalLsn(): Promise<string> {
		const [row] = (await dataSource.query(
			`select pg_current_wal_insert_lsn()::text as lsn`
		)) as Array<{ lsn: string }>;
		if (row === undefined) throw new Error('Missing PostgreSQL WAL position');
		return row.lsn;
	}

	async function walBytesSince(lsn: string): Promise<bigint> {
		const [row] = (await dataSource.query(
			`select pg_wal_lsn_diff(pg_current_wal_insert_lsn(), $1)::text as bytes`,
			[lsn]
		)) as Array<{ bytes: string }>;
		if (row === undefined) throw new Error('Missing PostgreSQL WAL estimate');
		return BigInt(row.bytes);
	}

	async function readMeasurementRelation(): Promise<RelationStorage> {
		const [row] = (await dataSource.query(`
			select pg_relation_filenode('organization_measurement'::regclass)::text
				as "fileNode",
				pg_relation_size('organization_measurement'::regclass)::text as bytes
		`)) as RelationStorage[];
		if (row === undefined) throw new Error('Missing measurement relation');
		return row;
	}

	async function readMeasurementStorage(): Promise<MeasurementStorageRow[]> {
		return (await dataSource.query(`
			select "organizationId", "time", ctid::text as ctid, xmin::text as xmin
			from "organization_measurement"
			order by "time", "organizationId"
		`)) as MeasurementStorageRow[];
	}

	async function measurementEvidenceColumns() {
		return (await dataSource.query(`
			select column_name as "columnName", is_nullable as "isNullable"
			from information_schema.columns
			where table_schema = current_schema()
				and table_name = 'organization_measurement'
				and column_name in (
					'tomlFetchResult', 'tomlEvidenceSequence', 'scanRunId'
				)
			order by column_name
		`)) as Array<{ columnName: string; isNullable: string }>;
	}

	async function createProductionShapedLegacyTables(): Promise<void> {
		await dataSource.query(`
			create type "organization_measurement_tomlstate_enum" as enum (
				'Unknown', 'Ok', 'RequestTimeout', 'DNSLookupFailed',
				'HostnameResolutionFailed', 'ConnectionTimeout', 'ConnectionRefused',
				'ConnectionResetByPeer', 'SocketClosedPrematurely', 'SocketTimeout',
				'HostUnreachable', 'NotFound', 'ParsingError', 'Forbidden',
				'ServerError', 'UnsupportedVersion', 'UnspecifiedError',
				'ValidatorNotSEP20Linked', 'EmptyValidatorsField'
			);
			create table "organization" (
				id integer primary key,
				"organizationIdValue" varchar not null unique
			);
			create table "organization_measurement" (
				"time" timestamptz not null,
				"organizationId" integer not null,
				"isSubQuorumAvailable" boolean not null,
				"index" smallint not null,
				"tomlState" "organization_measurement_tomlstate_enum"
					not null default 'Unknown',
				"tomlWarnings" jsonb not null default '[]'::jsonb,
				constraint "PK_e4b2a03164c957c8d1afd202127"
					primary key ("time", "organizationId"),
				constraint "FK_organization_measurement_organization"
					foreign key ("organizationId") references "organization"(id)
			);
			insert into "organization" values
				(1, 'org-1'), (2, 'org-2'), (3, 'org-3'), (4, 'org-4');
			insert into "organization_measurement"
			select '2019-01-01'::timestamptz + value * interval '1 second',
				1, false, 0, 'Unknown', '[]'::jsonb
			from generate_series(1, 10000) value;
			insert into "organization_measurement"
			select '2019-01-01'::timestamptz + value * interval '1 second',
				2, false, 0, 'Unknown', '[]'::jsonb
			from generate_series(1, 10000) value;
			insert into "organization_measurement" values
				(
					'2020-01-02', 1, false, 0, 'Ok',
					'["TlsCertificateVerificationDisabled"]'::jsonb
				),
				('2020-01-03', 1, false, 0, 'ParsingError', '[]'::jsonb),
				('2020-01-04', 3, false, 0, 'Ok', '{"unexpected":true}'::jsonb),
				('2020-01-05', 4, false, 0, 'NotFound', '[]'::jsonb);
		`);
	}
});
