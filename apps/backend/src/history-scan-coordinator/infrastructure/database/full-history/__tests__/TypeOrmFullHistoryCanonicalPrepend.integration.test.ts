import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import type { FullHistoryCheckpointWrite } from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { hashNetworkPassphrase } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryHistoricalBackfillMigration1784940000000 } from '../../migrations/1784940000000-FullHistoryHistoricalBackfillMigration.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(60_000);

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
		await expect(
			repository.findOperations(networkPassphrase, {
				limit: 10,
				transactionHash: previous.transactions[0]!.transactionHash
			})
		).resolves.toMatchObject({
			records: [
				{
					batchId: previous.batchId,
					ledgerSequence: '64',
					operationType: 'payment',
					outcome: 'succeeded',
					outcomeAvailable: true,
					outcomeFactScope: 'transaction_result_xdr'
				}
			],
			truncated: false
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
		await expect(operationResultCount(previous.batchId)).resolves.toBe(1);
		await expect(
			operationAccountReferenceCount(previous.batchId)
		).resolves.toBe(previous.operationAccountReferences.length);
		await expect(repository.prependCheckpoint(previous)).resolves.toMatchObject(
			{
				firstLedger: '64',
				nextLedger: '192',
				replayed: true
			}
		);
	});

	it('rolls back the historical batch and frontier when reference coverage fails', async () => {
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
		const frontierBefore = await frontier(networkPassphrase);

		await installRejectingReferenceCoverageTrigger();
		try {
			await expect(repository.prependCheckpoint(previous)).rejects.toThrow(
				/account-reference prepend test failure/
			);
		} finally {
			await removeRejectingReferenceCoverageTrigger();
		}

		await expect(batchCount(previous.batchId)).resolves.toBe(0);
		await expect(frontier(networkPassphrase)).resolves.toEqual(frontierBefore);
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

	async function operationResultCount(batchId: string): Promise<number> {
		const rows = await dataSource.query<Array<{ readonly count: number }>>(
			`select count(*)::integer as count
			 from "full_history_operation_result" result
			 join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					result."network_passphrase_hash"
				and operation."transaction_hash" = result."transaction_hash"
				and operation."operation_index" = result."operation_index"
			 where operation."batch_id" = $1`,
			[batchId]
		);
		return rows[0]?.count ?? -1;
	}

	async function operationAccountReferenceCount(
		batchId: string
	): Promise<number> {
		const rows = await dataSource.query<Array<{ readonly count: number }>>(
			`select count(*)::integer as count
			 from "full_history_operation_account_reference" reference
			 join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					reference."network_passphrase_hash"
				and operation."transaction_hash" = reference."transaction_hash"
				and operation."operation_index" = reference."operation_index"
			 where operation."batch_id" = $1`,
			[batchId]
		);
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
