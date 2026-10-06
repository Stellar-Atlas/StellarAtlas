import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { historyArchiveBrokerControlAdmissionSql } from '../HistoryArchiveBrokerControlAdmissionSql.js';
import {
	historyArchiveRootControlAllowedSql,
	historyArchiveRootFailureControlSchemaSql
} from '../HistoryArchiveRootFailureControl.js';

jest.setTimeout(60_000);
const root = 'https://control.example';
const scopes = `ready_scopes as materialized (
	select "archiveUrlIdentity",priority,"objectType",min("checkpointLedger") as first_checkpoint,
	max("checkpointLedger") as last_checkpoint,bool_or("checkpointLedger" is null) as has_null_checkpoint
	from fresh_objects group by "archiveUrlIdentity",priority,"objectType")`;
const baseline = `select "remoteId" from fresh_objects object where ${historyArchiveRootControlAllowedSql('object')} order by "remoteId"`;
const narrowed = `with ${scopes}, ${historyArchiveBrokerControlAdmissionSql}
	select object."remoteId" from fresh_admissible_scopes scope join fresh_objects object
	on object."archiveUrlIdentity"=scope."archiveUrlIdentity" and object.priority=scope.priority
	and object."objectType"=scope."objectType"
	where (object."checkpointLedger" between scope.first_checkpoint and scope.last_checkpoint
		or (scope.has_null_checkpoint and object."checkpointLedger" is null))
	and ${historyArchiveRootControlAllowedSql('object')} order by object."remoteId"`;
type Control = {
	root?: string;
	scope?: string;
	until?: string | null;
	lease?: string | null;
	probe?: number | null;
	unknown?: boolean;
	token?: string | null;
};

describe('scope-level root control candidate narrowing', () => {
	let pg: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		pg = await startDisposablePostgres();
		db = new DataSource({ type: 'postgres', url: pg.url });
		await db.initialize();
		await db.query(`${historyArchiveRootFailureControlSchemaSql};
			create table fresh_objects ("remoteId" uuid primary key,"archiveUrlIdentity" text not null,
			"objectType" text not null,"checkpointLedger" int,priority smallint not null,"dispatchToken" uuid);
			create table history_archive_object_queue ("remoteId" uuid primary key,"archiveUrlIdentity" text not null,
			"objectType" text not null,status text not null);
			create table history_archive_object_ready ("objectRemoteId" uuid primary key,"archiveUrlIdentity" text not null,"publishedAt" timestamptz);
			create table history_archive_object_claim_slot (slot int primary key,"objectRemoteId" uuid)`);
	});
	afterAll(async () => {
		if (db?.isInitialized) await db.destroy();
		if (pg) await pg.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate fresh_objects,history_archive_root_failure_control,history_archive_object_queue,history_archive_object_ready,history_archive_object_claim_slot'
		);
	});
	async function seed(
		checkpoints: (number | null)[],
		type = 'ledger',
		identity = root,
		priority = 2,
		token: string | null = null
	) {
		const rows = checkpoints.map((checkpoint) => ({
			id: randomUUID(),
			checkpoint
		}));
		await db.query(
			`insert into fresh_objects select i.id,$2,$3,i.checkpoint,$4,$5
			from jsonb_to_recordset($1::jsonb) as i(id uuid,checkpoint int)`,
			[JSON.stringify(rows), identity, type, priority, token]
		);
		return rows.map((row) => row.id);
	}
	async function control(value: Control = {}) {
		await db.query(
			`insert into history_archive_root_failure_control
			("archiveUrlIdentity",scope,"failureKind","blockedUntil","probeLeaseUntil","nextProbeCheckpoint","adaptiveProbeState","probeExecutionId")
			values($1,$2,'missing',$3,$4,$5,$6,$7)`,
			[
				value.root ?? root,
				value.scope ?? 'ledger',
				value.until ?? null,
				value.lease ?? null,
				value.probe ?? null,
				value.unknown ? { unknown: [{ start: 0, end: 10000 }] } : null,
				value.token ?? null
			]
		);
	}
	async function compare() {
		return db.transaction('REPEATABLE READ', async (manager) => {
			const expected = await manager.query(baseline);
			const actual = await manager.query(narrowed);
			expect(actual).toEqual(expected);
			return actual.map((row: { remoteId: string }) => row.remoteId);
		});
	}
	async function active(
		type: string,
		identity = root,
		claim = false,
		status = 'scanning'
	) {
		const id = randomUUID();
		await db.query(
			'insert into history_archive_object_queue values($1,$2,$3,$4)',
			[id, identity, type, status]
		);
		if (claim)
			await db.query(
				'insert into history_archive_object_claim_slot values(1,$1)',
				[id]
			);
		else
			await db.query(
				'insert into history_archive_object_ready values($1,$2,now())',
				[id, identity]
			);
	}
	it('preserves ungoverned NULL/range scopes across roots, categories and priorities', async () => {
		await seed([null, 63, 191]);
		await seed([127], 'results');
		await seed([255], 'ledger', root, 0);
		await seed([null, 319], 'scp', 'https://other.example');
		expect(await compare()).toHaveLength(7);
	});
	it('prunes blocked or leased lanes even when a candidate carries the probe token', async () => {
		const token = randomUUID();
		await seed([63, 127], 'ledger', root, 2, token);
		await control({ lease: '2099-01-01Z', token });
		expect(await compare()).toEqual([]);
		await db.query('truncate history_archive_root_failure_control');
		await control({ until: '2099-01-01Z' });
		expect(await compare()).toEqual([]);
	});
	it('keeps only the adaptive non-NULL point while retaining unrelated scopes', async () => {
		const ids = await seed([null, 63, 127, 191]);
		await seed([63, 127], 'transactions');
		await control({ unknown: true, probe: 127 });
		expect(await compare()).toContain(ids[2]);
		expect(await compare()).toHaveLength(3);
		const [scope] =
			await db.query(`with ${scopes}, ${historyArchiveBrokerControlAdmissionSql}
			select * from fresh_admissible_scopes where "objectType"='ledger'`);
		expect(scope).toMatchObject({
			first_checkpoint: '127',
			last_checkpoint: '127',
			has_null_checkpoint: false
		});
	});
	it('preserves an adaptive NULL target and excludes all non-NULL candidates', async () => {
		const ids = await seed([null, 63, 127]);
		await control({ unknown: true, probe: null });
		expect(await compare()).toEqual([ids[0]]);
		const [scope] = await db.query(
			`with ${scopes}, ${historyArchiveBrokerControlAdmissionSql} select * from fresh_admissible_scopes`
		);
		expect(scope).toMatchObject({
			first_checkpoint: null,
			last_checkpoint: null,
			has_null_checkpoint: true
		});
	});
	it('rejects conflicting wildcard/category points including NULL, and accepts agreeing points', async () => {
		const ids = await seed([null, 63, 127]);
		await control({ scope: '*', unknown: true, probe: 63 });
		await control({ unknown: true, probe: 127 });
		expect(await compare()).toEqual([]);
		await db.query(
			`update history_archive_root_failure_control set "nextProbeCheckpoint"=null where scope='ledger'`
		);
		expect(await compare()).toEqual([]);
		await db.query(
			`update history_archive_root_failure_control set "nextProbeCheckpoint"=63 where scope='ledger'`
		);
		expect(await compare()).toEqual([ids[1]]);
	});
	it('retains expired controls and their active-publication suppression', async () => {
		await seed([63]);
		await control({ until: '2000-01-01Z' });
		expect(await compare()).toHaveLength(1);
		await active('results');
		expect(await compare()).toHaveLength(1);
		await active('ledger');
		expect(await compare()).toEqual([]);
	});
	it('retains wildcard claim-slot suppression but ignores non-scanning or other-root claims', async () => {
		await seed([63]);
		await control({ scope: '*', until: '2000-01-01Z' });
		await active('bucket', 'https://other.example', true);
		expect(await compare()).toHaveLength(1);
		await db.query(
			'truncate history_archive_object_claim_slot,history_archive_object_queue'
		);
		await active('bucket', root, true, 'verified');
		expect(await compare()).toHaveLength(1);
		await db.query(`update history_archive_object_queue set status='scanning'`);
		expect(await compare()).toEqual([]);
	});
	it('does not fabricate an absent adaptive point or revive a blocked wildcard through a category exception', async () => {
		await seed([63, 127]);
		await control({ unknown: true, probe: 191 });
		expect(await compare()).toEqual([]);
		await control({ scope: '*', until: '2099-01-01Z' });
		expect(await compare()).toEqual([]);
	});
	it('preserves the statement snapshot while controls change concurrently', async () => {
		await seed([63, 127]);
		const reader = db.createQueryRunner();
		await reader.startTransaction('REPEATABLE READ');
		try {
			const before = await reader.query(narrowed);
			await control({ unknown: true, probe: 127 });
			expect(await reader.query(narrowed)).toEqual(before);
			await reader.commitTransaction();
		} finally {
			if (reader.isTransactionActive) await reader.rollbackTransaction();
			await reader.release();
		}
		expect(await compare()).toHaveLength(1);
	});
});
