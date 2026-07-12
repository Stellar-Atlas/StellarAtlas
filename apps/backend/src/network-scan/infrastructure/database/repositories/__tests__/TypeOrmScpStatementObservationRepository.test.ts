import { mock } from 'jest-mock-extended';
import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type { EntityManager, Repository } from 'typeorm';
import { ScpStatementObservation } from '@network-scan/domain/scp/ScpStatementObservation.js';
import { scpStatementObservationPolicy } from '@network-scan/domain/scp/ScpStatementObservationPolicy.js';
import { selectDeterministicScpStatementObservations } from '@network-scan/domain/scp/ScpStatementObservationConflictPolicy.js';
import { TypeOrmScpStatementObservationRepository } from '../TypeOrmScpStatementObservationRepository.js';

describe('TypeOrmScpStatementObservationRepository', () => {
	it('persists overflow in bounded batches and returns every canonical winner', async () => {
		const observations = Array.from({ length: 5_001 }, (_, index) =>
			createObservation(index)
		);
		const { manager, repository } = setupRepository(observations);

		const winners = await repository.saveMany(observations, 'network_scan');

		const upsertCalls = manager.query.mock.calls.filter(([sql]) =>
			String(sql).includes('insert into scp_statement_observation')
		);
		expect(upsertCalls).toHaveLength(
			Math.ceil(
				observations.length / scpStatementObservationPolicy.persistenceBatchSize
			)
		);
		const persistedHashes: string[] = [];
		for (const [, parameters] of upsertCalls) {
			expect(parameters).toBeDefined();
			expect(parameters!.length).toBeLessThanOrEqual(
				scpStatementObservationPolicy.persistenceBatchSize * 11
			);
			for (let index = 7; index < parameters!.length; index += 11) {
				persistedHashes.push(String(parameters![index]));
			}
		}
		expect(new Set(persistedHashes).size).toBe(observations.length);
		expect(winners).toHaveLength(observations.length);
		expect(
			new Set(winners.map(({ statementHash }) => statementHash)).size
		).toBe(observations.length);
	});

	it('returns the current winner when an older or equal attempt loses', async () => {
		const older = {
			...createObservation(1),
			observedAt: new Date('2026-07-10T12:00:00.000Z'),
			observedFromPeer: 'peer-z',
			statementHash: 'same-statement'
		};
		const winner = {
			...older,
			observedAt: new Date('2026-07-10T12:00:01.000Z'),
			observedFromPeer: 'peer-z'
		};
		const { repository } = setupRepository([winner]);

		await expect(repository.saveMany([older], 'network_scan')).resolves.toEqual(
			[winner]
		);
	});

	it('selects deterministic provenance and never moves observedAt backward', async () => {
		const older = {
			...createObservation(1),
			observedAt: new Date('2026-07-10T12:00:00.000Z'),
			observedFromPeer: 'peer-z',
			statementHash: 'same-statement'
		};
		const newer = {
			...older,
			observedAt: new Date('2026-07-10T12:00:01.000Z'),
			observedFromPeer: 'peer-a'
		};
		const { manager, repository } = setupRepository([newer]);

		expect(selectDeterministicScpStatementObservations([newer, older])).toEqual(
			[newer]
		);
		expect(selectDeterministicScpStatementObservations([older, newer])).toEqual(
			[newer]
		);

		await repository.saveMany([older, newer], 'network_scan');
		const upserts = manager.query.mock.calls.filter(([sql]) =>
			String(sql).includes('insert into scp_statement_observation')
		);
		expect(upserts).toHaveLength(2);
		expect(
			upserts.some(([, parameters]) => parameters?.[1] === newer.observedAt)
		).toBe(true);
		expect(upserts[0]?.[0]).toMatch(
			/where row\(\s*excluded\."observedAt",[\s\S]*\) > row\(\s*stored\."observedAt",/i
		);
	});

	it('configures local lock, statement, and idle transaction timeouts', async () => {
		const { manager, repository } = setupRepository([createObservation(1)]);

		await repository.saveMany([createObservation(1)], 'network_scan');

		expect(manager.query).toHaveBeenNthCalledWith(
			1,
			expect.stringContaining("set_config('lock_timeout'"),
			[
				`${scpStatementObservationPolicy.databaseLockTimeoutMs}ms`,
				`${scpStatementObservationPolicy.databaseStatementTimeoutMs}ms`,
				`${scpStatementObservationPolicy.databaseStatementTimeoutMs}ms`
			]
		);
	});

	it('bounds pool acquisition on the underlying PostgreSQL pool', () => {
		const typeOrmRepository = mock<Repository<ScpStatementObservation>>();
		const manager = mock<EntityManager>();
		const poolOptions: { connectionTimeoutMillis?: number } = {
			connectionTimeoutMillis: 0
		};
		Object.defineProperty(manager, 'connection', {
			value: { driver: { master: { options: poolOptions } } }
		});
		Object.defineProperty(typeOrmRepository, 'manager', { value: manager });

		new TypeOrmScpStatementObservationRepository(typeOrmRepository, {
			poolAcquireTimeoutMs: 123
		});

		expect(poolOptions.connectionTimeoutMillis).toBe(123);
	});

	it('deletes expired observations with a bounded skip-locked query', async () => {
		const { manager, repository } = setupRepository([], [{ id: 1 }, { id: 2 }]);
		const before = new Date('2026-07-09T12:00:00.000Z');

		const deleted = await repository.deleteOlderThan(
			before,
			scpStatementObservationPolicy.cleanupBatchSize * 2
		);

		expect(deleted).toBe(2);
		expect(manager.query).toHaveBeenCalledWith(
			expect.stringMatching(/for update skip locked/i),
			[before, scpStatementObservationPolicy.cleanupBatchSize]
		);
	});

	it('reads projection recovery in bounded cursor pages', async () => {
		const observations = [createObservation(1), createObservation(2)];
		const { manager, repository } = setupRepository(observations);
		const observedAfter = new Date('2026-07-10T00:00:00.000Z');

		const page = await repository.findProjectionPage({
			afterId: 0,
			limit: scpStatementObservationPolicy.projectionBackfillBatchSize * 2,
			observedAfter
		});

		expect(page.observations).toEqual(observations);
		expect(manager.query).toHaveBeenCalledWith(
			expect.stringMatching(/where id > \$1 and "observedAt" >= \$2/i),
			[
				0,
				observedAfter,
				scpStatementObservationPolicy.projectionBackfillBatchSize
			]
		);
	});

	it('reads cross-process projection events as current canonical winners', async () => {
		const observation = createObservation(1);
		const { manager, repository } = setupRepository(
			[observation],
			[],
			[{ id: 9, statementHash: observation.statementHash }]
		);

		const page = await repository.findProjectionEventPage({
			afterId: 0,
			limit: 5_000
		});

		expect(page).toEqual({
			hasMore: false,
			nextAfterId: 9,
			observations: [observation]
		});
		expect(manager.query).toHaveBeenCalledWith(
			expect.stringMatching(/from scp_statement_projection_event/i),
			[0, scpStatementObservationPolicy.projectionEventTailBatchSize]
		);
	});

	it('persists a monotonic scanner-owned live ledger watermark', async () => {
		const observation = createObservation(1);
		const { manager, repository } = setupRepository([observation]);

		await repository.saveMany([observation], 'scp_live_collector');

		expect(manager.query).toHaveBeenCalledWith(
			expect.stringContaining('insert into scp_latest_observed_ledger'),
			[
				observation.slotIndex,
				new Date(Number(observation.values[0]!.closeTime) * 1_000),
				observation.observedAt,
				'scp_live_collector'
			]
		);
	});

	it('does not issue an unbounded retention delete', async () => {
		const { manager, repository } = setupRepository([]);

		await expect(
			repository.deleteOlderThan(new Date('2026-07-09T12:00:00.000Z'), 0)
		).resolves.toBe(0);
		expect(manager.transaction).not.toHaveBeenCalled();
	});

	it('deletes projection-event backlog in bounded skip-locked batches', async () => {
		const { manager, repository } = setupRepository([], [{ id: 1 }]);
		const before = new Date('2026-07-10T11:55:00.000Z');

		await expect(
			repository.deleteProjectionEventsOlderThan(before, 50_000)
		).resolves.toBe(1);
		expect(manager.query).toHaveBeenCalledWith(
			expect.stringMatching(
				/from scp_statement_projection_event[\s\S]*for update skip locked/i
			),
			[before, scpStatementObservationPolicy.cleanupBatchSize]
		);
	});
});

function setupRepository(
	canonical: readonly CrawlerScpStatementObservation[],
	deletedRows: ReadonlyArray<{ id: number }> = [],
	projectionEvents: ReadonlyArray<{ id: number; statementHash: string }> = []
) {
	const typeOrmRepository = mock<Repository<ScpStatementObservation>>();
	const manager = mock<EntityManager>();
	Object.defineProperty(typeOrmRepository, 'manager', { value: manager });
	manager.transaction.mockImplementation(async (work) => work(manager));
	manager.query.mockImplementation(async (sql, parameters) => {
		const statement = String(sql);
		if (statement.includes('for update skip locked')) return [...deletedRows];
		if (
			statement.includes('select id, "statementHash"') &&
			statement.includes('from scp_statement_projection_event')
		) {
			return [...projectionEvents];
		}
		if (
			statement.includes('select') &&
			statement.includes('from scp_statement_observation')
		) {
			const afterId = statement.includes('where id >')
				? Number(parameters?.[0] ?? 0)
				: 0;
			const hashes = Array.isArray(parameters?.[0])
				? new Set(parameters[0] as string[])
				: null;
			return canonical
				.map((observation, index) => ({
					...observation,
					id: index + 1
				}))
				.filter(
					(row) =>
						row.id > afterId &&
						(hashes === null || hashes.has(row.statementHash))
				);
		}
		return [];
	});
	return {
		manager,
		repository: new TypeOrmScpStatementObservationRepository(typeOrmRepository)
	};
}

function createObservation(index: number): CrawlerScpStatementObservation {
	return {
		nodeId: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		observedAt: new Date(1_783_600_000_000 + index),
		observedFromAddress: '127.0.0.1:11625',
		observedFromPeer:
			'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
		pledges: {
			commit: { counter: 1, value: `value-${index}` },
			nH: 1,
			quorumSetHash: `quorum-${index}`
		},
		signature: `signature-${index}`,
		slotIndex: String(index),
		statementHash: `statement-${index}`,
		statementType: 'externalize',
		statementXdr: `xdr-${index}`,
		values: [
			{
				closeTime: String(1_783_600_000 + index),
				txSetHash: `tx-set-${index}`,
				upgradeCount: 0,
				value: `value-${index}`
			}
		]
	};
}
