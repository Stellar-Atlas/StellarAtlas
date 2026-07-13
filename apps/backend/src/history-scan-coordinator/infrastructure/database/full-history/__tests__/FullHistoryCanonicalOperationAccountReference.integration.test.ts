import {
	encodeMuxedAccount,
	encodeMuxedAccountToAddress,
	StrKey
} from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import {
	fullHistoryOperationAccountReference,
	FullHistoryOperationAccountReferenceCoverageError
} from '../../../../domain/full-history/FullHistoryCanonicalOperationAccountReference.js';
import { hashNetworkPassphrase } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { insertBatch } from '../FullHistoryCanonicalBatchStore.js';
import { storeCanonicalBaseFacts } from '../FullHistoryCanonicalFactStore.js';
import { storeCanonicalOperations } from '../FullHistoryCanonicalOperationStore.js';
import { storeCanonicalOperationResults } from '../FullHistoryCanonicalOperationResultStore.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(60_000);

describe('canonical operation account references', () => {
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
		repository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('matches G by base key and M by exact muxed identity', async () => {
		const networkPassphrase = 'Canonical G M operation reference network';
		const destinationBase = account(81);
		const destination = muxedAccount(destinationBase, '42');
		const differentMuxedIdentity = muxedAccount(destinationBase, '43');
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 6_001,
			explicitOperationAccountReferences: [
				{ accountId: destination, role: 'destination' }
			],
			networkPassphrase,
			operationType: 'payment'
		});

		await expect(repository.writeCheckpoint(input)).resolves.toMatchObject({
			replayed: false
		});
		await expect(repository.writeCheckpoint(input)).resolves.toMatchObject({
			replayed: true
		});
		const basePage = await repository.findOperations(networkPassphrase, {
			accountId: destinationBase,
			limit: 10
		});
		expect(basePage).toMatchObject({
			coverage: {
				accountReferenceIndexedBatches: 1,
				accountReferencesComplete: true,
				canonicalBatches: 1,
				complete: true,
				operationFactsComplete: true
			},
			records: [
				{
					accountReferenceDecoderVersion:
						'fixture-operation-account-reference-decoder/1',
					accountReferences: expect.arrayContaining([
						{
							accountId: destination,
							baseAccountId: destinationBase,
							role: 'destination'
						}
					])
				}
			]
		});
		await expect(
			repository.findOperations(networkPassphrase, {
				accountId: destination,
				limit: 10
			})
		).resolves.toMatchObject({ records: [{ operationType: 'payment' }] });
		await expect(
			repository.findOperations(networkPassphrase, {
				accountId: differentMuxedIdentity,
				limit: 10
			})
		).resolves.toMatchObject({ records: [] });
		await expect(
			repository.findOperations(networkPassphrase, {
				accountId: input.operations[0]!.sourceAccount,
				limit: 10
			})
		).resolves.toMatchObject({
			records: [
				{
					accountReferences: expect.arrayContaining([
						{
							accountId: input.operations[0]!.sourceAccount,
							baseAccountId: input.operations[0]!.sourceAccount,
							role: 'effective_source'
						}
					])
				}
			]
		});

		const changedDestination = account(82);
		await expect(
			repository.writeCheckpoint({
				...input,
				operationAccountReferences: [
					input.operationAccountReferences[0]!,
					fullHistoryOperationAccountReference(
						input.operations[0]!,
						'destination',
						changedDestination
					)
				]
			})
		).rejects.toMatchObject({ reason: 'canonical-row-conflict' });
		await expect(repository.writeCheckpoint(input)).resolves.toMatchObject({
			replayed: true
		});
	});

	it('refuses account queries until every canonical batch has reference coverage', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 6_002,
			networkPassphrase: 'Incomplete operation reference coverage network'
		});
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		await dataSource.transaction(async (manager) => {
			await insertBatch(manager, input, networkHash);
			await storeCanonicalBaseFacts(manager, input, networkHash);
			await storeCanonicalOperations(manager, input, networkHash);
			await storeCanonicalOperationResults(manager, input, networkHash);
		});

		await expect(
			repository.findOperations(input.networkPassphrase, {
				accountId: input.operations[0]!.sourceAccount,
				limit: 10
			})
		).rejects.toBeInstanceOf(FullHistoryOperationAccountReferenceCoverageError);
		await expect(
			repository.findOperations(input.networkPassphrase, { limit: 10 })
		).resolves.toMatchObject({
			coverage: {
				accountReferenceIndexedBatches: 0,
				accountReferencesComplete: false,
				complete: false,
				operationFactsComplete: true
			},
			records: [
				{
					accountReferenceDecoderVersion: null,
					accountReferences: []
				}
			]
		});
	});

	it('rolls back the forward batch and watermark when reference coverage fails', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 6_003,
			networkPassphrase: 'Atomic operation reference write network'
		});
		await installRejectingCoverageTrigger();
		try {
			await expect(repository.writeCheckpoint(input)).rejects.toThrow(
				/account-reference coverage test failure/
			);
		} finally {
			await removeRejectingCoverageTrigger();
		}
		const rows = await dataSource.query<Array<{ readonly count: number }>>(
			`select (
				select count(*)::integer from "full_history_ingestion_batch"
				where id = $1
			) + (
				select count(*)::integer from "full_history_operation" where "batch_id" = $1
			) + (
				select count(*)::integer from "full_history_watermark"
				where "network_passphrase_hash" = $2
			) as count`,
			[input.batchId, hashNetworkPassphrase(input.networkPassphrase).toBuffer()]
		);
		expect(rows[0]?.count).toBe(0);
	});

	async function installRejectingCoverageTrigger(): Promise<void> {
		await dataSource.query(`
			create function reject_operation_reference_coverage_test()
			returns trigger language plpgsql as $function$
			begin
				raise exception 'account-reference coverage test failure';
			end
			$function$;
			create trigger reject_operation_reference_coverage_test
			before insert on
				"full_history_operation_account_reference_batch_coverage"
			for each row execute function reject_operation_reference_coverage_test()
		`);
	}

	async function removeRejectingCoverageTrigger(): Promise<void> {
		await dataSource.query(`
			drop trigger if exists reject_operation_reference_coverage_test on
				"full_history_operation_account_reference_batch_coverage";
			drop function if exists reject_operation_reference_coverage_test()
		`);
	}
});

function account(seed: number): string {
	return StrKey.encodeEd25519PublicKey(Buffer.alloc(32, seed));
}

function muxedAccount(baseAccount: string, id: string): string {
	return encodeMuxedAccountToAddress(encodeMuxedAccount(baseAccount, id));
}
