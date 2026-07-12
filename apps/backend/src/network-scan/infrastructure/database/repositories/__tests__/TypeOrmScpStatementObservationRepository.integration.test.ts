import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import { DataSource } from 'typeorm';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { ScpLiveCanonicalTailMigration1784800000000 } from '../../migrations/1784800000000-ScpLiveCanonicalTailMigration.js';
import { TypeOrmScpStatementObservationRepository } from '../TypeOrmScpStatementObservationRepository.js';

jest.setTimeout(120_000);

describe('TypeOrmScpStatementObservationRepository.integration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			dropSchema: true,
			entities: [ScpStatementObservation],
			logging: false,
			poolSize: 2,
			synchronize: true,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		const migrationRunner = dataSource.createQueryRunner();
		await migrationRunner.connect();
		try {
			await new ScpLiveCanonicalTailMigration1784800000000().up(
				migrationRunner
			);
		} finally {
			await migrationRunner.release();
		}
	});

	afterEach(async () => {
		if (dataSource === undefined || !dataSource.isInitialized) return;
		await dataSource.query(
			'truncate table scp_statement_projection_event restart identity'
		);
		await dataSource.query('truncate table scp_latest_observed_ledger');
		await dataSource.getRepository(ScpStatementObservation).clear();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('converges concurrent collectors and returns rejected attempts as current winners', async () => {
		const first = createRepository();
		const second = createRepository();
		const older = createObservation(
			new Date('2026-07-10T12:00:00.000Z'),
			'peer-z'
		);
		const newer = createObservation(
			new Date('2026-07-10T12:00:01.000Z'),
			'peer-a'
		);

		await Promise.all([
			first.saveMany([newer], 'scp_live_collector'),
			second.saveMany([older], 'network_scan')
		]);
		let stored = await findStored();
		expect(stored.observedAt).toEqual(newer.observedAt);
		expect(stored.observedFromPeer).toBe(newer.observedFromPeer);

		await expect(second.saveMany([older], 'network_scan')).resolves.toEqual([
			newer
		]);

		const higherEqual = { ...newer, observedFromPeer: 'peer-z' };
		await Promise.all([
			first.saveMany([higherEqual], 'scp_live_collector'),
			second.saveMany([newer], 'network_scan')
		]);
		stored = await findStored();
		expect(stored.observedAt).toEqual(newer.observedAt);
		expect(stored.observedFromPeer).toBe(higherEqual.observedFromPeer);
		await expect(second.saveMany([newer], 'network_scan')).resolves.toEqual([
			higherEqual
		]);
	});

	it('tails ongoing cross-process writes and current conflict winners without holes', async () => {
		const writer = createRepository();
		const projector = createRepository();
		const initial = withLedgerValue(
			createObservation(new Date('2026-07-10T12:00:00.000Z'), 'peer-a'),
			'100',
			'1783684800'
		);
		await writer.saveMany([initial], 'network_scan');

		const firstPage = await projector.findProjectionEventPage({
			afterId: 0,
			limit: 100
		});
		expect(firstPage.observations).toEqual([initial]);

		const winner = {
			...initial,
			observedAt: new Date('2026-07-10T12:00:01.000Z'),
			observedFromPeer: 'peer-z',
			values: [{ ...initial.values[0]!, closeTime: '1783684801' }]
		};
		await writer.saveMany([winner], 'scp_live_collector');
		await writer.saveMany([initial], 'network_scan');
		const secondPage = await projector.findProjectionEventPage({
			afterId: firstPage.nextAfterId,
			limit: 100
		});

		expect(secondPage.observations).toEqual([winner]);
		expect(secondPage.nextAfterId).toBeGreaterThan(firstPage.nextAfterId);
		const canonicalDelta = await projector.findLatest({
			after: {
				observedAtMs: initial.observedAt.getTime(),
				statementHash: initial.statementHash
			},
			limit: 100,
			order: 'asc'
		});
		expect(canonicalDelta).toHaveLength(1);
		expect(canonicalDelta[0]?.observedAt).toEqual(winner.observedAt);
		expect(canonicalDelta[0]?.observedFromPeer).toBe(winner.observedFromPeer);
		await expect(
			projector.findProjectionEventPage({
				afterId: secondPage.nextAfterId,
				limit: 100
			})
		).resolves.toEqual({
			hasMore: false,
			nextAfterId: secondPage.nextAfterId,
			observations: []
		});

		await expect(projector.findLatestObservedLedger()).resolves.toEqual({
			closedAt: new Date('2026-07-10T12:00:01.000Z'),
			observedAt: winner.observedAt,
			sequence: '100',
			source: 'scp_live_collector'
		});
	});

	it('bounds a lock-blocked canonical write with the configured lock timeout', async () => {
		const repository = createRepository({
			lockTimeoutMs: 100,
			statementTimeoutMs: 1_000
		});
		const baseline = createObservation(
			new Date('2026-07-10T12:00:00.000Z'),
			'peer-a'
		);
		const newer = {
			...baseline,
			observedAt: new Date('2026-07-10T12:00:01.000Z')
		};
		await repository.saveMany([baseline], 'network_scan');
		const lock = dataSource.createQueryRunner();
		await lock.connect();
		await lock.startTransaction();

		try {
			await lock.query(
				`select id from scp_statement_observation where "statementHash" = $1 for update`,
				[baseline.statementHash]
			);
			const startedAt = Date.now();

			await expect(
				repository.saveMany([newer], 'network_scan')
			).rejects.toThrow(/lock timeout/i);
			expect(Date.now() - startedAt).toBeLessThan(1_000);
		} finally {
			await lock.rollbackTransaction();
			await lock.release();
		}

		const stored = await findStored();
		expect(stored.observedAt).toEqual(baseline.observedAt);
	});

	it('cancels a canonical write that exceeds the statement timeout', async () => {
		const repository = createRepository({
			lockTimeoutMs: 1_000,
			statementTimeoutMs: 100
		});
		await dataSource.query(`
			create function delay_scp_observation_insert() returns trigger as $$
			begin
				perform pg_sleep(1);
				return new;
			end;
			$$ language plpgsql;
			create trigger delay_scp_observation_insert
			before insert on scp_statement_observation
			for each row execute function delay_scp_observation_insert();
		`);

		try {
			await expect(
				repository.saveMany(
					[createObservation(new Date('2026-07-10T12:00:00.000Z'), 'peer-a')],
					'network_scan'
				)
			).rejects.toThrow(/statement timeout/i);
		} finally {
			await dataSource.query(`
				drop trigger if exists delay_scp_observation_insert
				on scp_statement_observation;
				drop function if exists delay_scp_observation_insert();
			`);
		}
	});

	it('bounds projection backfill while every pool connection is checked out', async () => {
		const first = dataSource.createQueryRunner();
		const second = dataSource.createQueryRunner();
		await first.connect();
		await second.connect();
		const repository = createRepository({ poolAcquireTimeoutMs: 100 });

		try {
			const startedAt = Date.now();
			await expect(
				repository.findProjectionPage({
					afterId: 0,
					limit: 100,
					observedAfter: new Date('2026-07-10T00:00:00.000Z')
				})
			).rejects.toThrow(/timeout exceeded when trying to connect/i);
			expect(Date.now() - startedAt).toBeLessThan(1_000);
		} finally {
			await second.release();
			await first.release();
		}
	});

	function createRepository(
		options: {
			lockTimeoutMs?: number;
			poolAcquireTimeoutMs?: number;
			statementTimeoutMs?: number;
		} = {}
	) {
		return new TypeOrmScpStatementObservationRepository(
			dataSource.getRepository(ScpStatementObservation),
			options
		);
	}

	async function findStored(): Promise<ScpStatementObservation> {
		return dataSource.getRepository(ScpStatementObservation).findOneByOrFail({
			statementHash: 'deterministic-concurrent-statement'
		});
	}
});

function createObservation(
	observedAt: Date,
	observedFromPeer: string
): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt,
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer,
		pledges: {} as CrawlerScpStatementObservation['pledges'],
		signature: 'signature',
		slotIndex: '1',
		statementHash: 'deterministic-concurrent-statement',
		statementType: 'externalize',
		statementXdr: 'xdr',
		values: []
	};
}

function withLedgerValue(
	observation: CrawlerScpStatementObservation,
	slotIndex: string,
	closeTime: string
): CrawlerScpStatementObservation {
	return {
		...observation,
		slotIndex,
		values: [
			{
				closeTime,
				txSetHash: 'tx-set',
				upgradeCount: 0,
				value: 'value'
			}
		]
	};
}
