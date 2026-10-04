import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	nodeAvailabilityWindow,
	nodeObservedAvailabilitySql
} from '../NodeObservedAvailabilitySql.js';
import {
	nodeMeasurementAverageFromDatabaseRecord,
	type NodeMeasurementAverageRecord
} from '../TypeOrmNodeMeasurementRepository.js';

describe('node observed availability', () => {
	jest.setTimeout(60_000);
	let postgres: DisposablePostgres;
	let db: DataSource;
	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		db = await new DataSource({
			type: 'postgres',
			url: postgres.url,
			entities: []
		}).initialize();
		await db.query(`create table node(id text primary key, "publicKeyValue" text);
		create table network_scan(time timestamptz primary key, completed boolean);
		create table network_measurement(time timestamptz primary key, "nrOfActiveValidators" int);
		create table node_measurement_v2(time timestamptz, "nodeId" text,
		  "isActive" boolean,"isValidating" boolean,"isFullValidator" boolean,
		  "isOverLoaded" boolean,"historyArchiveHasError" boolean,"index" int,
		  primary key(time,"nodeId"));
		create table node_measurement_day_v2(time date,"nodeId" text,
		  "isActiveCount" int,"isValidatingCount" int,"isFullValidatorCount" int,
		  "isOverloadedCount" int,"historyArchiveErrorCount" int,"indexSum" int,"crawlCount" int,
		  primary key(time,"nodeId"));
		insert into node values ('a','node-a'),('b','node-b');`);
	});
	afterAll(async () => {
		await db?.destroy();
		await postgres?.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate network_scan,network_measurement,node_measurement_v2,node_measurement_day_v2'
		);
		await db.query("set timezone = 'UTC'");
	});

	async function sample(
		time: string,
		value: boolean | null,
		completed = true,
		active: number | null = 2,
		id = 'a'
	) {
		await db.query('insert into network_scan values($1,$2)', [time, completed]);
		if (active !== null)
			await db.query('insert into network_measurement values($1,$2)', [
				time,
				active
			]);
		if (value !== null)
			await db.query(
				'insert into node_measurement_v2 values($1,$2,$3,$3,$3,$4,$4,$5)',
				[time, id, value, !value, value ? 100 : 0]
			);
	}
	async function day(
		day: string,
		samples: number,
		available: number,
		id = 'a'
	) {
		await db.query(
			`insert into network_scan select $1::date + n * interval '1 minute',true from generate_series(1,$2::int) n;
		`,
			[day, samples]
		);
		await db.query(
			`insert into network_measurement select time,2 from network_scan where time >= $1::date and time < $1::date + interval '1 day'`,
			[day]
		);
		await db.query(
			'insert into node_measurement_day_v2 values($1,$2,$3,$3,$3,$4,$4,$5,$6)',
			[day, id, available, samples - available, available * 100, samples]
		);
	}
	async function averages(at = '2026-10-01T12:00:00Z', days = 30) {
		const rows: NodeMeasurementAverageRecord[] = await db.query(
			nodeObservedAvailabilitySql,
			nodeAvailabilityWindow(new Date(at), days)
		);
		return rows
			.map(nodeMeasurementAverageFromDatabaseRecord)
			.sort((a, b) => a.publicKey.localeCompare(b.publicKey));
	}
	it('weights existing full-day samples, not daily percentages or absent days', async () => {
		await day('2026-09-02', 100, 90);
		await day('2026-09-20', 1, 0);
		const [row] = await averages();
		expect(row.activeAvg).toBe(89.11);
		expect(row.validatingAvg).toBe(89.11);
		expect(row.fullValidatorAvg).toBe(89.11);
		expect(row.overLoadedAvg).toBe(10.89);
		expect(row.historyArchiveErrorAvg).toBe(10.89);
		expect(row.indexAvg).toBe(89.11);
		expect(row.coverage).toEqual({ observedDays: 2, observedScans: 101 });
	});
	it('reads only healthy boundary samples with exact exclusive/inclusive endpoints', async () => {
		await sample('2026-09-01T12:00:00Z', false); // excluded left endpoint
		await sample('2026-09-01T12:00:01Z', true);
		await sample('2026-10-01T12:00:00Z', false); // included right endpoint
		await sample('2026-10-01T12:00:01Z', false);
		await day('2026-09-02', 2, 2);
		// Boundary-day rollups must never be double-counted.
		await db.query(
			`insert into node_measurement_day_v2 values('2026-09-01','a',20,20,20,0,0,2000,20),('2026-10-01','a',20,20,20,0,0,2000,20)`
		);
		const [row] = await averages();
		expect(row.validatingAvg).toBe(75);
		expect(row.coverage).toEqual({ observedDays: 3, observedScans: 4 });
	});
	it('24h excludes incomplete, missing-network, zero-validator and orphan samples', async () => {
		await sample('2026-09-30T13:00:00Z', true);
		await sample('2026-09-30T14:00:00Z', false, false);
		await sample('2026-09-30T15:00:00Z', false, true, null);
		await sample('2026-09-30T16:00:00Z', false, true, 0);
		await db.query(
			`insert into node_measurement_v2 values('2026-10-01T00:01:00Z','a',false,false,false,true,true,0)`
		);
		const [row] = await averages(undefined, 1);
		expect(row.validatingAvg).toBe(100);
		expect(row.coverage).toEqual({ observedDays: 1, observedScans: 1 });
	});
	it('preserves observed individual and all-node failures when the network monitor is healthy', async () => {
		await sample('2026-09-30T13:00:00Z', false, true, 1);
		await sample('2026-09-30T14:00:00Z', null, true, 1);
		await sample('2026-09-30T15:00:00Z', false, true, 1, 'b');
		expect(
			(await averages(undefined, 1)).map((row) => [
				row.publicKey,
				row.validatingAvg,
				row.coverage
			])
		).toEqual([
			['node-a', 0, { observedDays: 1, observedScans: 1 }],
			['node-b', 0, { observedDays: 1, observedScans: 1 }]
		]);
	});
	it('excludes legacy mixed-health and unanchored full-day rollups without reading raw full days', async () => {
		await day('2026-09-02', 2, 1);
		await db.query(
			`update network_measurement set "nrOfActiveValidators"=0 where time='2026-09-02T00:01:00Z'`
		);
		await day('2026-09-03', 2, 1);
		await db.query(
			`delete from network_measurement where time='2026-09-03T00:01:00Z'`
		);
		await db.query(
			`insert into node_measurement_day_v2 values('2026-09-04','a',1,1,1,0,0,100,1)`
		);
		// Even a healthy raw sample in a mixed full day is not an unbounded fallback.
		await db.query(
			`insert into node_measurement_v2 values('2026-09-02T00:02:00Z','a',true,true,true,false,false,100)`
		);
		expect(await averages()).toEqual([]);
	});
	it('accepts partial node coverage but rejects rollup counts beyond completed evidence', async () => {
		await day('2026-09-02', 2, 1);
		await db.query(`update node_measurement_day_v2 set "crawlCount"=1`);
		expect((await averages())[0].coverage?.observedScans).toBe(1);
		await db.query(`update node_measurement_day_v2 set "crawlCount"=3`);
		expect(await averages()).toEqual([]);
	});
	it('does not reject a trusted full day merely because a separate scan was incomplete', async () => {
		await day('2026-09-02', 2, 1);
		await sample('2026-09-02T18:00:00Z', false, false, 0);
		expect((await averages())[0].validatingAvg).toBe(50);
	});
	it('handles UTC midnight boundaries and non-UTC database sessions without double counting', async () => {
		await db.query("set timezone='America/New_York'");
		await sample('2026-09-30T00:00:00Z', false);
		await sample('2026-09-30T23:59:59Z', true);
		await sample('2026-10-01T00:00:00Z', false);
		const [row] = await averages('2026-10-01T00:00:00Z', 1);
		expect(row.validatingAvg).toBe(50);
		expect(row.coverage).toEqual({ observedDays: 2, observedScans: 2 });
	});
	it('keeps no observations unknown rather than claiming success', async () => {
		await sample('2026-09-30T13:00:00Z', false, true, 0);
		expect(await averages()).toEqual([]);
	});
});

test('availability windows reject unbounded ranges and keep DST-independent durations', () => {
	const [from, at, firstFullDay, lastFullDay] = nodeAvailabilityWindow(
		new Date('2026-11-02T12:00:00Z'),
		30
	);
	expect(at.getTime() - from.getTime()).toBe(30 * 86_400_000);
	expect(firstFullDay.toISOString()).toBe('2026-10-04T00:00:00.000Z');
	expect(lastFullDay.toISOString()).toBe('2026-11-02T00:00:00.000Z');
	expect(() => nodeAvailabilityWindow(at, 31)).toThrow(RangeError);
	expect(() => nodeAvailabilityWindow(at, 0)).toThrow(RangeError);
	expect(() => nodeAvailabilityWindow(new Date('invalid'), 1)).toThrow(
		RangeError
	);
});
