import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { PromoteFullHistoryCheckpoint } from '../../../../use-cases/promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';
import { fullHistoryEntities } from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../full-history/TypeOrmFullHistoryCanonicalRepository.js';
import {
	publicNetworkPassphrase,
	readFeeBumpEtlFixture
} from '../../../full-history-promotion/__tests__/RealStellarXdrFixtures.js';
import { StellarFullHistoryCheckpointDecoder } from '../../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../TypeOrmFullHistoryCheckpointCandidateRepository.js';
import {
	installPromotionSchema,
	seedPromotionCandidate
} from './FullHistoryPromotionPostgresFixture.js';

jest.setTimeout(60_000);

describe('PromoteFullHistoryCheckpoint fee-bump persistence', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

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
		await installPromotionSchema(dataSource);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('persists outer hash/fee and inner source/sequence from real stellar-etl XDR', async () => {
		const feeBump = readFeeBumpEtlFixture();
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: publicNetworkPassphrase,
			seed: 110,
			transaction: feeBump
		});
		const canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(
			dataSource
		);
		const promoter = new PromoteFullHistoryCheckpoint(
			new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
			new StellarFullHistoryCheckpointDecoder(),
			canonicalRepository
		);
		await promoter.promote(seeded.target);

		await expect(
			canonicalRepository.findTransaction(
				publicNetworkPassphrase,
				feeBump.transactionHash
			)
		).resolves.toMatchObject({
			envelopeType: 'fee-bump',
			feeBid: '93750',
			feeCharged: '55289',
			ledgerSequence: '59699270',
			resultCode: 1,
			sourceAccount: 'GA2DUR2ZXDJM6CYREPP45E6UPZZP2765YUC65FCBJRV3AIY7ZPFXEGL3',
			sourceAccountSequence: '241479047249629101',
			successful: true,
			transactionIndex: 0
		});
		await expect(
			canonicalRepository.findOperations(publicNetworkPassphrase, {
				limit: 10,
				transactionHash: feeBump.transactionHash
			})
		).resolves.toMatchObject({
			records: [
				{
					factScope: 'operation_body_and_envelope',
					operationIndex: 0,
					operationType: 'invoke_host_function',
					outcomeAvailable: false,
					sourceAccount:
						'GA2DUR2ZXDJM6CYREPP45E6UPZZP2765YUC65FCBJRV3AIY7ZPFXEGL3',
					sourceAccountOrigin: 'transaction',
					transactionIndex: 0
				}
			],
			truncated: false
		});
		const rows = (await dataSource.query(
			`select "ledger_sequence" as ledger, "transaction_index" as index,
				encode("transaction_hash", 'hex') as hash
			from "full_history_transaction_result"`
		)) as Array<{
			readonly hash: string;
			readonly index: number;
			readonly ledger: string;
		}>;
		expect(rows).toEqual([
			{
				hash: feeBump.transactionHash.toHex(),
				index: 0,
				ledger: '59699270'
			}
		]);
		const operationResults = await dataSource.query<
			Array<{
				readonly factScope: string;
				readonly operationResultCode: number | null;
				readonly operationSpecificResultCode: number | null;
				readonly outcome: string;
			}>
		>(`
			select "outcome", "operation_result_code" as "operationResultCode",
				"operation_specific_result_code" as "operationSpecificResultCode",
				"fact_scope" as "factScope"
			from "full_history_operation_result"
		`);
		expect(operationResults).toEqual([
			{
				factScope: 'transaction_result_xdr',
				operationResultCode: 0,
				operationSpecificResultCode: 0,
				outcome: 'succeeded'
			}
		]);
	});
});
