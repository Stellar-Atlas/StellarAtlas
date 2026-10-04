import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { organizationObservedAvailabilitySql } from '../OrganizationObservedAvailabilitySql.js';
import {
	organizationMeasurementAverageFromDatabaseRecord,
	type OrganizationMeasurementAverageRecord
} from '../TypeOrmOrganizationMeasurementRepository.js';

describe('organization observed availability', () => {
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
		await db.query(`create table organization(id text primary key, "organizationIdValue" text);
		create table network_scan(time timestamptz primary key, completed boolean);
		create table network_measurement(time timestamptz primary key, "nrOfActiveValidators" int);
		create table organization_measurement(time timestamptz, "organizationId" text, "isSubQuorumAvailable" boolean, primary key(time,"organizationId"));
		insert into organization values ('a','org-a'),('b','org-b');`);
	});
	afterAll(async () => {
		await db?.destroy();
		await postgres?.stop();
	});
	beforeEach(async () => {
		await db.query(
			'truncate network_scan, network_measurement, organization_measurement'
		);
	});

	async function scan(
		day: number,
		a: boolean | null,
		b: boolean | null,
		completed = true,
		active: number | null = 3
	) {
		const time = `2026-09-${day.toString().padStart(2, '0')}T12:00:00Z`;
		await db.query('insert into network_scan values ($1,$2)', [
			time,
			completed
		]);
		if (active !== null)
			await db.query('insert into network_measurement values ($1,$2)', [
				time,
				active
			]);
		for (const [id, available] of [
			['a', a],
			['b', b]
		] as const) {
			if (available !== null)
				await db.query(
					'insert into organization_measurement values ($1,$2,$3)',
					[time, id, available]
				);
		}
	}
	async function averages(
		from = '2026-09-01T00:00:00Z',
		to = '2026-10-01T00:00:00Z'
	) {
		const rows: OrganizationMeasurementAverageRecord[] = await db.query(
			organizationObservedAvailabilitySql,
			[from, to]
		);
		return rows
			.map(organizationMeasurementAverageFromDatabaseRecord)
			.sort((a, b) => a.organizationId.localeCompare(b.organizationId));
	}
	it('uses valid samples despite missing days and preserves a partial outage', async () => {
		await scan(2, true, true);
		await scan(20, false, true);
		await scan(25, true, true);
		expect(await averages()).toEqual([
			{
				organizationId: 'org-a',
				isSubQuorumAvailableAvg: 66.67,
				coverage: { observedDays: 3, observedScans: 3 }
			},
			{
				organizationId: 'org-b',
				isSubQuorumAvailableAvg: 100,
				coverage: { observedDays: 3, observedScans: 3 }
			}
		]);
	});
	it('excludes incomplete, no-network-evidence and fleet-wide unavailable scans', async () => {
		await scan(2, true, true);
		await scan(3, false, true, false);
		await scan(4, false, true, true, null);
		await scan(5, false, true, true, 0);
		await scan(6, false, false, true, 0);
		expect(
			(await averages()).map((row) => [
				row.isSubQuorumAvailableAvg,
				row.coverage?.observedScans
			])
		).toEqual([
			[100, 1],
			[100, 1]
		]);
	});
	it('returns no percentage for an entirely indeterminate window', async () => {
		await scan(2, false, false, true, 0);
		await scan(3, true, true, false);
		await scan(4, true, true, true, 0);
		expect(await averages()).toEqual([]);
	});
	it('does not count missing organization observations as downtime', async () => {
		await scan(2, null, true);
		await scan(3, false, true);
		expect((await averages())[0]).toEqual({
			organizationId: 'org-a',
			isSubQuorumAvailableAvg: 0,
			coverage: { observedDays: 1, observedScans: 1 }
		});
	});
	it('preserves real all-org threshold failures when some validators are observed active', async () => {
		await scan(2, false, false, true, 2);
		expect(
			(await averages()).map((row) => row.isSubQuorumAvailableAvg)
		).toEqual([0, 0]);
	});
	it('does not hide an observed individual failure when other organizations have no observation', async () => {
		await scan(2, false, null, true, 1);
		expect(await averages()).toEqual([
			{
				organizationId: 'org-a',
				isSubQuorumAvailableAvg: 0,
				coverage: { observedDays: 1, observedScans: 1 }
			}
		]);
	});
	it('bounds the rolling window exactly and weights samples rather than missing calendar days', async () => {
		await scan(2, false, true);
		await scan(3, true, true);
		await scan(4, false, true);
		expect(
			(await averages('2026-09-02T12:00:00Z', '2026-09-03T12:00:00Z'))[0]
				.isSubQuorumAvailableAvg
		).toBe(100);
	});
});
