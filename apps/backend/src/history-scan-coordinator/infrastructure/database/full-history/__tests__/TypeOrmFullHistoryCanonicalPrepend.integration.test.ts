import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryCheckpointWrite } from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { hashNetworkPassphrase } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryHistoricalBackfillMigration1784940000000 } from '../../migrations/1784940000000-FullHistoryHistoricalBackfillMigration.js';
import { TypeOrmFullHistoryOperationBackfillRepository } from '../../full-history-operation-backfill/TypeOrmFullHistoryOperationBackfillRepository.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	emptyFullHistoryCanonicalProjectionCounts,
	expectedFullHistoryCanonicalProjectionCounts,
	fullHistoryCanonicalProjectionCounts
} from './FullHistoryCanonicalProjectionAssertions.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(180_000);

describe('TypeOrmFullHistoryCanonicalRepository historical prepend', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryCanonicalRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			type: 'postgres',
			url: postgres.url
		});
		await dataSource.initialize();
		await installFullHistoryCanonicalSchema(dataSource);
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		await runner.startTransaction();
		await new FullHistoryHistoricalBackfillMigration1784940000000().up(runner);
		await runner.commitTransaction();
		await runner.release();
		repository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('prepends one exact checkpoint while preserving the forward watermark', async () => {
		const networkPassphrase = 'Canonical historical prepend network';
		const previous = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_001,
			checkpointLedger: 127,
			networkPassphrase
		});
		const current = linkAfter(
			previous,
			await seedFullHistoryCheckpoint(dataSource, {
				batchNumber: 1_002,
				checkpointLedger: 191,
				networkPassphrase
			})
		);
		await repository.writeCheckpoint(current);
		await expect(
			repository.getCoverage(networkPassphrase)
		).resolves.toMatchObject({
			firstLedger: '128',
			latestEvidence: { batchId: current.batchId, lastLedger: '191' },
			lastLedger: '191'
		});

		await expect(repository.prependCheckpoint(previous)).resolves.toEqual({
			batchId: previous.batchId,
			firstLedger: '64',
			nextLedger: '192',
			replayed: false
		});
		await expect(frontier(networkPassphrase)).resolves.toEqual({
			firstBatchId: previous.batchId,
			firstLedger: '64',
			lastBatchId: current.batchId,
			nextLedger: '192'
		});
		await expect(
			repository.getCoverage(networkPassphrase)
		).resolves.toMatchObject({
			firstLedger: '64',
			latestEvidence: { batchId: current.batchId, lastLedger: '191' },
			lastLedger: '191'
		});
		await expect(
			fullHistoryCanonicalProjectionCounts(dataSource, previous.batchId)
		).resolves.toEqual(emptyFullHistoryCanonicalProjectionCounts);
		const operationBackfill = new TypeOrmFullHistoryOperationBackfillRepository(
			dataSource
		);
		await operationBackfill.storeOperations(previous);
		await expect(
			fullHistoryCanonicalProjectionCounts(dataSource, previous.batchId)
		).resolves.toEqual(expectedFullHistoryCanonicalProjectionCounts(previous));
		await expect(repository.prependCheckpoint(previous)).resolves.toMatchObject(
			{
				firstLedger: '64',
				nextLedger: '192',
				replayed: true
			}
		);
	});

	it('allows forward and historical frontier writes to persist concurrently', async () => {
		const networkPassphrase = 'Concurrent canonical frontier network';
		const previous = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_041,
			checkpointLedger: 127,
			networkPassphrase
		});
		const current = linkAfter(
			previous,
			await seedFullHistoryCheckpoint(dataSource, {
				batchNumber: 1_042,
				checkpointLedger: 191,
				networkPassphrase
			})
		);
		const next = linkAfter(
			current,
			await seedFullHistoryCheckpoint(dataSource, {
				batchNumber: 1_043,
				checkpointLedger: 255,
				networkPassphrase
			})
		);
		await repository.writeCheckpoint(current);

		const blocker = dataSource.createQueryRunner();
		await blocker.connect();
		await installHistoricalWriteBarrier(previous.batchId);
		await blocker.query('select pg_advisory_lock(1784869999)');
		const prepend = repository.prependCheckpoint(previous);
		try {
			await waitForHistoricalWriteBarrier();
			await expect(repository.writeCheckpoint(next)).resolves.toMatchObject({
				batchId: next.batchId,
				nextLedger: '256',
				replayed: false
			});
		} finally {
			await blocker.query('select pg_advisory_unlock(1784869999)');
			await blocker.release();
			await prepend.catch(() => undefined);
			await removeHistoricalWriteBarrier();
		}
		await expect(prepend).resolves.toMatchObject({
			batchId: previous.batchId,
			firstLedger: '64',
			nextLedger: '256',
			replayed: false
		});
		await expect(frontier(networkPassphrase)).resolves.toEqual({
			firstBatchId: previous.batchId,
			firstLedger: '64',
			lastBatchId: next.batchId,
			nextLedger: '256'
		});
	});

	it('commits historical base facts without touching projection tables', async () => {
		const networkPassphrase = 'Canonical historical reference rollback network';
		const previous = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_031,
			checkpointLedger: 127,
			networkPassphrase
		});
		const current = linkAfter(
			previous,
			await seedFullHistoryCheckpoint(dataSource, {
				batchNumber: 1_032,
				checkpointLedger: 191,
				networkPassphrase
			})
		);
		await repository.writeCheckpoint(current);
		await installRejectingReferenceCoverageTrigger();
		try {
			await expect(
				repository.prependCheckpoint(previous)
			).resolves.toMatchObject({
				batchId: previous.batchId,
				firstLedger: '64',
				replayed: false
			});
		} finally {
			await removeRejectingReferenceCoverageTrigger();
		}

		await expect(batchCount(previous.batchId)).resolves.toBe(1);
		await expect(frontier(networkPassphrase)).resolves.toMatchObject({
			firstBatchId: previous.batchId,
			firstLedger: '64',
			lastBatchId: current.batchId,
			nextLedger: '192'
		});
		await expect(
			fullHistoryCanonicalProjectionCounts(dataSource, previous.batchId)
		).resolves.toEqual(emptyFullHistoryCanonicalProjectionCounts);
	});

	it('rejects a boundary mismatch and rolls back every historical row', async () => {
		const networkPassphrase = 'Canonical historical boundary network';
		const previous = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_011,
			checkpointLedger: 127,
			networkPassphrase
		});
		const current = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_012,
			checkpointLedger: 191,
			networkPassphrase
		});
		await repository.writeCheckpoint(current);

		await expect(repository.prependCheckpoint(previous)).rejects.toMatchObject({
			reason: 'canonical-row-conflict'
		});
		await expect(batchCount(previous.batchId)).resolves.toBe(0);
		await expect(frontier(networkPassphrase)).resolves.toMatchObject({
			firstBatchId: current.batchId,
			firstLedger: '128',
			lastBatchId: current.batchId,
			nextLedger: '192'
		});
	});

	it('rejects nonadjacent and provenance-changing historical writes', async () => {
		const networkPassphrase = 'Canonical historical conflict network';
		const previous = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_021,
			checkpointLedger: 127,
			networkPassphrase
		});
		const current = linkAfter(
			previous,
			await seedFullHistoryCheckpoint(dataSource, {
				batchNumber: 1_022,
				checkpointLedger: 191,
				networkPassphrase
			})
		);
		await repository.writeCheckpoint(current);
		const gap = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1_023,
			checkpointLedger: 63,
			networkPassphrase
		});
		await expect(repository.prependCheckpoint(gap)).rejects.toMatchObject({
			reason: 'watermark-gap'
		});
		await repository.prependCheckpoint(previous);
		await expect(
			repository.prependCheckpoint({
				...previous,
				decoderVersion: 'forged-decoder/2'
			})
		).rejects.toMatchObject({ reason: 'immutable-provenance-conflict' });
	});

	async function frontier(networkPassphrase: string) {
		const rows = (await dataSource.query(
			`select "first_batch_id" as "firstBatchId",
				"first_ledger"::text as "firstLedger",
				"last_batch_id" as "lastBatchId",
				"next_ledger"::text as "nextLedger"
			 from "full_history_watermark"
			 where "network_passphrase_hash" = $1`,
			[hashNetworkPassphrase(networkPassphrase).toBuffer()]
		)) as Array<{
			readonly firstBatchId: string;
			readonly firstLedger: string;
			readonly lastBatchId: string;
			readonly nextLedger: string;
		}>;
		return rows[0];
	}

	async function batchCount(batchId: string): Promise<number> {
		const rows = (await dataSource.query(
			`select count(*)::integer as count
			 from "full_history_ingestion_batch" where id = $1`,
			[batchId]
		)) as Array<{ readonly count: number }>;
		return rows[0]?.count ?? -1;
	}

	async function installRejectingReferenceCoverageTrigger(): Promise<void> {
		await dataSource.query(`
			create function reject_operation_reference_prepend_test()
			returns trigger language plpgsql as $function$
			begin
				raise exception 'account-reference prepend test failure';
			end
			$function$;
			create trigger reject_operation_reference_prepend_test
			before insert on
				"full_history_operation_account_reference_batch_coverage"
			for each row execute function reject_operation_reference_prepend_test()
		`);
	}

	async function removeRejectingReferenceCoverageTrigger(): Promise<void> {
		await dataSource.query(`
			drop trigger if exists reject_operation_reference_prepend_test on
				"full_history_operation_account_reference_batch_coverage";
			drop function if exists reject_operation_reference_prepend_test()
		`);
	}

	async function installHistoricalWriteBarrier(batchId: string): Promise<void> {
		await dataSource.query(`
			create table full_history_slow_batch_test (batch_id uuid primary key);
			create function block_historical_write_test()
			returns trigger language plpgsql as $function$
			begin
				if exists (
					select 1 from full_history_slow_batch_test
					where batch_id = new.batch_id
				) then
					perform pg_advisory_xact_lock(1784869999);
				end if;
				return new;
			end
			$function$;
			create trigger block_historical_write_test
			before insert on "full_history_transaction"
			for each row execute function block_historical_write_test()
		`);
		await dataSource.query(
			'insert into full_history_slow_batch_test (batch_id) values ($1)',
			[batchId]
		);
	}

	async function waitForHistoricalWriteBarrier(): Promise<void> {
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const rows = await dataSource.query<
				Array<{ readonly blocked: boolean }>
			>(`
				select exists (
					select 1 from pg_stat_activity
					where wait_event = 'advisory'
						and lower(query) like
							'%insert into "full_history_transaction"%'
				) as blocked
			`);
			if (rows[0]?.blocked === true) return;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		throw new Error(
			'Historical canonical write did not reach its test barrier'
		);
	}

	async function removeHistoricalWriteBarrier(): Promise<void> {
		await dataSource.query(`
			drop trigger if exists block_historical_write_test on
				"full_history_transaction";
			drop function if exists block_historical_write_test();
			drop table if exists full_history_slow_batch_test
		`);
	}
});

function linkAfter(
	previous: FullHistoryCheckpointWrite,
	current: FullHistoryCheckpointWrite
): FullHistoryCheckpointWrite {
	const previousLedgerHash = previous.ledgers.at(-1)?.ledgerHash;
	const currentFirst = current.ledgers[0];
	if (previousLedgerHash === undefined || currentFirst === undefined) {
		throw new Error('Checkpoint fixture has no boundary ledger');
	}
	return {
		...current,
		ledgers: [
			{ ...currentFirst, previousLedgerHash },
			...current.ledgers.slice(1)
		]
	};
}
