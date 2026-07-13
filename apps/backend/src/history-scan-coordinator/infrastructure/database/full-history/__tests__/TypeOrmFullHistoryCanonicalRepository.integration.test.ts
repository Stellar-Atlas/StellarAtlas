import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { fullHistoryLedgerSequence } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../TypeOrmFullHistoryCanonicalRepository.js';
import {
	fullHistoryEntities,
	installFullHistoryCanonicalSchema,
	seedFullHistoryCheckpoint
} from './FullHistoryCanonicalFixture.js';

jest.setTimeout(60_000);

describe('TypeOrmFullHistoryCanonicalRepository', () => {
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

	it('atomically persists the 63-row genesis checkpoint without copied XDR', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 1,
			feeBid: '9223372036854775807'
		});
		await expect(repository.writeCheckpoint(input)).resolves.toEqual({
			batchId: input.batchId,
			nextLedger: '64',
			replayed: false
		});

		await expect(
			repository.getWatermark(input.networkPassphrase)
		).resolves.toEqual(
			expect.objectContaining({
				lastBatchId: input.batchId,
				nextLedger: '64'
			})
		);
		const ledger = await repository.findLedger(
			input.networkPassphrase,
			fullHistoryLedgerSequence('1')
		);
		expect(ledger).toEqual(
			expect.objectContaining({
				ledgerSequence: '1',
				operationCount: input.transactions[0]!.operationCount,
				protocolVersion: 27,
				transactionCount: 1
			})
		);
		const transaction = await repository.findTransaction(
			input.networkPassphrase,
			input.transactions[0]!.transactionHash
		);
		expect(transaction).toEqual(
			expect.objectContaining({
				closedAt: input.ledgers[0]!.closedAt,
				feeBid: '9223372036854775807',
				feeCharged: '100',
				ledgerSequence: '1',
				successful: true
			})
		);

		expect(await batchCounts(input.batchId)).toEqual({
			batches: 1,
			ledgers: 63,
			results: 1,
			transactions: 1
		});
		const lengths = (await dataSource.query(
			`
				select min(octet_length("ledger_hash"))::integer as minimum,
					max(octet_length("ledger_hash"))::integer as maximum
				from "full_history_ledger" where "batch_id" = $1
			`,
			[input.batchId]
		)) as Array<{ readonly maximum: number; readonly minimum: number }>;
		expect(lengths).toEqual([{ maximum: 32, minimum: 32 }]);
		const xdrColumns = await dataSource.query(`
			select column_name from information_schema.columns
			where table_name like 'full_history_%' and lower(column_name) like '%xdr%'
		`);
		expect(xdrColumns).toEqual([]);
		await expect(
			dataSource.query(
				`update "full_history_transaction_result"
				set "ledger_sequence" = 2 where "batch_id" = $1`,
				[input.batchId]
			)
		).rejects.toThrow(/fk_full_history_result_transaction/i);
	});

	it('returns aggregate coverage and a bounded recent transaction page', async () => {
		const networkPassphrase = 'Canonical bounded read network';
		const genesis = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 5,
			networkPassphrase
		});
		const regular = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 6,
			checkpointLedger: 127,
			networkPassphrase
		});
		const otherNetwork = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 7,
			networkPassphrase: 'Canonical isolated coverage network'
		});
		await repository.writeCheckpoint(genesis);
		await repository.writeCheckpoint(regular);
		await repository.writeCheckpoint(otherNetwork);

		const coverage = await repository.getCoverage(networkPassphrase);
		expect(coverage).toEqual({
			archiveSourceCount: 2,
			batchCount: 2,
			firstLedger: '1',
			lastLedger: '127',
			latestEvidence: {
				archiveUrlIdentity: regular.archiveUrlIdentity,
				batchId: regular.batchId,
				checkpointLedger: regular.checkpointLedger,
				checkpointProofId: regular.proofId,
				decoderVersion: regular.decoderVersion,
				firstLedger: regular.firstLedger,
				ingestedAt: expect.any(Date),
				lastLedger: regular.lastLedger,
				proofEvaluatedAt: regular.proofEvaluatedAt,
				proofVersion: regular.proofVersion,
				sourceObjects: {
					checkpointState: {
						contentDigest: regular.sources.checkpointState.contentDigest,
						objectRemoteId: regular.sources.checkpointState.remoteId
					},
					ledger: {
						contentDigest: regular.sources.ledger.contentDigest,
						objectRemoteId: regular.sources.ledger.remoteId
					},
					results: {
						contentDigest: regular.sources.results.contentDigest,
						objectRemoteId: regular.sources.results.remoteId
					},
					transactions: {
						contentDigest: regular.sources.transactions.contentDigest,
						objectRemoteId: regular.sources.transactions.remoteId
					}
				}
			},
			latestLedgerClosedAt: regular.ledgers.at(-1)!.closedAt,
			ledgerCount: 127,
			nextLedger: '128',
			transactionCount: 2,
			transactionResultCount: 2,
			updatedAt: expect.any(Date)
		});
		for (const objectType of [
			'checkpointState',
			'ledger',
			'results',
			'transactions'
		] as const) {
			expect(
				coverage?.latestEvidence.sourceObjects[objectType].contentDigest.toHex()
			).toBe(regular.sources[objectType].contentDigest.toHex());
		}
		await expect(
			repository.getCoverage(otherNetwork.networkPassphrase)
		).resolves.toMatchObject({
			latestEvidence: {
				batchId: otherNetwork.batchId,
				checkpointProofId: otherNetwork.proofId
			}
		});

		const firstPage = await repository.findRecentTransactions(
			networkPassphrase,
			1
		);
		expect(firstPage.truncated).toBe(true);
		expect(firstPage.records).toHaveLength(1);
		expect(firstPage.records[0]).toMatchObject({
			closedAt: regular.ledgers[0]!.closedAt,
			ledgerSequence: '64',
			transactionIndex: 0
		});
		expect(firstPage.records[0]!.transactionHash.toHex()).toBe(
			regular.transactions[0]!.transactionHash.toHex()
		);

		const completePage = await repository.findRecentTransactions(
			networkPassphrase,
			2
		);
		expect(completePage.truncated).toBe(false);
		expect(
			completePage.records.map((record) => record.transactionHash.toHex())
		).toEqual([
			regular.transactions[0]!.transactionHash.toHex(),
			genesis.transactions[0]!.transactionHash.toHex()
		]);
	});

	it('filters proof-linked operation facts with transaction result outcomes', async () => {
		const networkPassphrase = 'Canonical operation query network';
		const genesis = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 71,
			networkPassphrase,
			operationType: 'payment'
		});
		const regular = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 72,
			checkpointLedger: 127,
			networkPassphrase,
			operationType: 'create_account'
		});
		await repository.writeCheckpoint(genesis);
		await repository.writeCheckpoint(regular);

		const page = await repository.findOperations(networkPassphrase, {
			closedAtFrom: regular.ledgers[0]!.closedAt,
			closedAtTo: regular.ledgers.at(-1)!.closedAt,
			firstLedger: fullHistoryLedgerSequence('64'),
			lastLedger: fullHistoryLedgerSequence('127'),
			limit: 10,
			operationType: 'create_account',
			sourceAccount: regular.operations[0]!.sourceAccount,
			transactionHash: regular.transactions[0]!.transactionHash
		});
		expect(page).toMatchObject({
			coverage: {
				canonicalBatches: 2,
				complete: true,
				firstIndexedLedger: '1',
				firstOutcomeIndexedLedger: '1',
				indexedBatches: 2,
				lastIndexedLedger: '127',
				lastOutcomeIndexedLedger: '127',
				outcomeIndexedBatches: 2,
				outcomesComplete: true
			},
			records: [
				{
					archiveUrlIdentity: regular.archiveUrlIdentity,
					batchId: regular.batchId,
					checkpointLedger: '127',
					checkpointProofId: regular.proofId,
					factScope: 'operation_body_and_envelope',
					ledgerSequence: '64',
					operationIndex: 0,
					operationType: 'create_account',
					operationResultCode: 0,
					operationSpecificResultCode: 0,
					outcome: 'succeeded',
					outcomeAvailable: true,
					outcomeDecoderVersion: 'fixture-operation-result-decoder/1',
					outcomeFactScope: 'transaction_result_xdr',
					proofVersion: 5,
					sourceAccountOrigin: 'transaction',
					transactionIndex: 0
				}
			],
			truncated: false
		});
		expect(page.records[0]!.transactionHash.toHex()).toBe(
			regular.transactions[0]!.transactionHash.toHex()
		);
		expect(page.records[0]).not.toHaveProperty('successful');
		expect(page.records[0]).not.toHaveProperty('effects');
		expect(page.records[0]).not.toHaveProperty('events');
		await expect(
			repository.getOperationCoverage(networkPassphrase)
		).resolves.toMatchObject({
			canonicalBatches: 2,
			complete: true,
			indexedBatches: 2,
			outcomeIndexedBatches: 2,
			outcomesComplete: true
		});

		await expect(
			repository.findOperations(networkPassphrase, { limit: 1 })
		).resolves.toMatchObject({
			records: [{ ledgerSequence: '64' }],
			truncated: true
		});
	});

	it('returns empty canonical reads for a network without coverage', async () => {
		await expect(
			repository.getCoverage('Canonical network without coverage')
		).resolves.toBeNull();
		await expect(
			repository.findRecentTransactions(
				'Canonical network without coverage',
				10
			)
		).resolves.toEqual({ records: [], truncated: false });
	});

	it.each([0, -1, 1.5, 51, Number.NaN, Number.POSITIVE_INFINITY])(
		'rejects an unbounded recent transaction limit of %p',
		async (limit) => {
			await expect(
				repository.findRecentTransactions('Canonical limit network', limit)
			).rejects.toThrow(/limit must be an integer between 1 and 50/);
		}
	);

	it('deduplicates exact concurrent replay without mutating batch provenance', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 2
		});
		const receipts = await Promise.all([
			repository.writeCheckpoint(input),
			repository.writeCheckpoint(input)
		]);
		expect(receipts.map((receipt) => receipt.replayed).sort()).toEqual([
			false,
			true
		]);
		expect(await batchCounts(input.batchId)).toEqual({
			batches: 1,
			ledgers: 63,
			results: 1,
			transactions: 1
		});

		const before = await batchTimestamp(input.batchId);
		await expect(repository.writeCheckpoint(input)).resolves.toMatchObject({
			replayed: true
		});
		expect(await batchTimestamp(input.batchId)).toEqual(before);
		await expect(
			dataSource.query(
				'update "full_history_ingestion_batch" set "decoder_version" = $1 where id = $2',
				['forged', input.batchId]
			)
		).rejects.toThrow(/immutable/);
	});

	it('rejects an idempotent batch replay when an operation fact changes', async () => {
		const input = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 73
		});
		await repository.writeCheckpoint(input);
		await expect(
			repository.writeCheckpoint({
				...input,
				operations: [{ ...input.operations[0]!, operationType: 'manage_data' }]
			})
		).rejects.toMatchObject({ reason: 'canonical-row-conflict' });
	});

	it('advances from genesis through a regular 64-ledger checkpoint', async () => {
		const networkPassphrase = 'Canonical contiguous checkpoint network';
		const genesis = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 3,
			networkPassphrase
		});
		const regular = await seedFullHistoryCheckpoint(dataSource, {
			batchNumber: 4,
			checkpointLedger: 127,
			networkPassphrase
		});
		await repository.writeCheckpoint(genesis);
		await expect(repository.writeCheckpoint(regular)).resolves.toEqual({
			batchId: regular.batchId,
			nextLedger: '128',
			replayed: false
		});
		expect(await batchCounts(regular.batchId)).toEqual({
			batches: 1,
			ledgers: 64,
			results: 1,
			transactions: 1
		});
		await expect(
			repository.getWatermark(networkPassphrase)
		).resolves.toMatchObject({
			lastBatchId: regular.batchId,
			nextLedger: '128'
		});
	});

	async function batchTimestamp(batchId: string): Promise<string> {
		const rows = (await dataSource.query(
			`select "ingested_at"::text as value
			from "full_history_ingestion_batch" where id = $1`,
			[batchId]
		)) as Array<{ readonly value: string }>;
		if (rows[0] === undefined) throw new Error('Missing batch timestamp');
		return rows[0].value;
	}

	async function batchCounts(batchId: string): Promise<{
		readonly batches: number;
		readonly ledgers: number;
		readonly results: number;
		readonly transactions: number;
	}> {
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
		if (rows[0] === undefined) throw new Error('Missing batch counts');
		return rows[0];
	}
});
