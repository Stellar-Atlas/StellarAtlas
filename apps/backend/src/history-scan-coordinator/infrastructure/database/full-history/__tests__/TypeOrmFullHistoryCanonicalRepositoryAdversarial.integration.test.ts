import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { FullHistoryCanonicalError } from '../../../../domain/full-history/FullHistoryCanonicalError.js';
import type { FullHistoryUint64String } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	fixtureHash,
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(60_000);

describe('full-history canonical repository adversarial writes', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmFullHistoryCanonicalRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({
			entities: fullHistoryEntities,
			logging: false,
			synchronize: false,
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

	it('rolls back batch, ledgers, and watermark when one canonical hash conflicts', async () => {
		const networkPassphrase = 'Canonical rollback network';
		const first = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 11,
			networkPassphrase
		});
		await repository.writeCheckpoint(first);
		const conflicting = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 12,
			checkpointLedger: 127,
			networkPassphrase,
			transactionHash: first.transactions[0]!.transactionHash
		});

		await expect(repository.writeCheckpoint(conflicting)).rejects.toMatchObject(
			{
				name: 'FullHistoryCanonicalError',
				reason: 'canonical-row-conflict'
			}
		);
		expect(await countBatchRows(conflicting.batchId)).toEqual([0, 0, 0, 0]);
		await expect(
			repository.getWatermark(networkPassphrase)
		).resolves.toMatchObject({
			lastBatchId: first.batchId,
			nextLedger: '64'
		});
	});

	it('rejects gaps before inserting any immutable batch evidence', async () => {
		const networkPassphrase = 'Canonical gap network';
		const first = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 21,
			networkPassphrase
		});
		await repository.writeCheckpoint(first);
		const gap = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 22,
			checkpointLedger: 191,
			networkPassphrase
		});

		await expect(repository.writeCheckpoint(gap)).rejects.toEqual(
			expect.objectContaining<Partial<FullHistoryCanonicalError>>({
				reason: 'watermark-gap'
			})
		);
		expect(await countBatchRows(gap.batchId)).toEqual([0, 0, 0, 0]);
	});

	it('rejects pending proofs and exact-source digest substitution at the DB boundary', async () => {
		const pending = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 31,
			proofStatus: 'pending'
		});
		await expect(repository.writeCheckpoint(pending)).rejects.toMatchObject({
			reason: 'invalid-proof-provenance'
		});
		expect(await countBatchRows(pending.batchId)).toEqual([0, 0, 0, 0]);

		const digestSubstitution = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 32
		});
		const forged = {
			...digestSubstitution,
			sources: {
				...digestSubstitution.sources,
				ledger: {
					...digestSubstitution.sources.ledger,
					contentDigest: fixtureHash('forged-ledger-digest')
				}
			}
		};
		await expect(repository.writeCheckpoint(forged)).rejects.toMatchObject({
			reason: 'invalid-proof-provenance'
		});
		expect(await countBatchRows(forged.batchId)).toEqual([0, 0, 0, 0]);
	});

	it('rejects a same-ID replay carrying changed provenance', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 41
		});
		await repository.writeCheckpoint(input);
		await expect(
			repository.writeCheckpoint({ ...input, decoderVersion: 'different/2' })
		).rejects.toMatchObject({ reason: 'immutable-provenance-conflict' });
		expect(await countBatchRows(input.batchId)).toEqual([1, 63, 1, 1]);
	});

	it('revalidates branded bigint strings at the runtime write boundary', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 51
		});
		const forged = {
			...input,
			transactions: [
				{
					...input.transactions[0]!,
					feeBid: '-1' as FullHistoryUint64String
				}
			]
		};
		await expect(repository.writeCheckpoint(forged)).rejects.toThrow(
			/canonical unsigned decimal/
		);
		expect(await countBatchRows(input.batchId)).toEqual([0, 0, 0, 0]);
	});

	async function countBatchRows(batchId: string): Promise<number[]> {
		const rows = (await dataSource.query(
			`
				select
					(select count(*)::integer from "full_history_ingestion_batch"
						where id = $1) as batches,
					(select count(*)::integer from "full_history_ledger"
						where "batch_id" = $1) as ledgers,
					(select count(*)::integer from "full_history_transaction"
						where "batch_id" = $1) as transactions,
					(select count(*)::integer from "full_history_transaction_result"
						where "batch_id" = $1) as results
			`,
			[batchId]
		)) as Array<{
			readonly batches: number;
			readonly ledgers: number;
			readonly results: number;
			readonly transactions: number;
		}>;
		const row = rows[0];
		if (row === undefined) throw new Error('Missing count result');
		return [row.batches, row.ledgers, row.transactions, row.results];
	}
});
