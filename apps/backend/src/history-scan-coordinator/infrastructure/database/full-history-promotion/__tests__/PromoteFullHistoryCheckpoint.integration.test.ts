import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { fullHistoryLedgerSequence } from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { PromoteFullHistoryCheckpoint } from '../../../../use-cases/promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { fullHistoryEntities } from '../../full-history/__tests__/FullHistoryCanonicalFixture.js';
import { StellarFullHistoryCheckpointDecoder } from '../../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import {
	publicNetworkPassphrase,
	readClassicArchiveTransactionFixture
} from '../../../full-history-promotion/__tests__/RealStellarXdrFixtures.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../TypeOrmFullHistoryCheckpointCandidateRepository.js';
import {
	installPromotionSchema,
	seedPromotionCandidate
} from './FullHistoryPromotionPostgresFixture.js';

jest.setTimeout(60_000);

describe('PromoteFullHistoryCheckpoint with exact Postgres evidence', () => {
	let canonicalRepository: TypeOrmFullHistoryCanonicalRepository;
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let promoter: PromoteFullHistoryCheckpoint;

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
		canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(dataSource);
		promoter = new PromoteFullHistoryCheckpoint(
			new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
			new StellarFullHistoryCheckpointDecoder(),
			canonicalRepository
		);
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	it('promotes exact real XDR observations once under concurrent replay', async () => {
		const realTransaction = readClassicArchiveTransactionFixture();
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: publicNetworkPassphrase,
			seed: 101,
			transaction: realTransaction
		});
		const receipts = await Promise.all([
			promoter.promote(seeded.target),
			promoter.promote(seeded.target)
		]);

		expect(receipts.map((receipt) => receipt.replayed).sort()).toEqual([
			false,
			true
		]);
		expect(new Set(receipts.map((receipt) => receipt.batchId)).size).toBe(1);
		expect(await canonicalCounts(seeded.proofId)).toEqual({
			batches: 1,
			ledgers: 64,
			results: 1,
			transactions: 1
		});

		const firstLedger = await canonicalRepository.findLedger(
			publicNetworkPassphrase,
			fullHistoryLedgerSequence('556800')
		);
		expect(firstLedger?.closedAt).toEqual(seeded.exactFirstClosedAt);
		expect(firstLedger?.closedAt).not.toEqual(
			new Date('2040-01-01T00:00:00.000Z')
		);
		const transaction = await canonicalRepository.findTransaction(
			publicNetworkPassphrase,
			realTransaction.transactionHash
		);
		expect(transaction).toMatchObject({
			envelopeType: 'tx-v0',
			ledgerSequence: '556808',
			transactionIndex: 0
		});
		await expectExactStoredProvenance(seeded.proofId);
	});

	it('promotes the globally special 1..63 genesis checkpoint', async () => {
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: 'Promotion genesis fixture network',
			seed: 102
		});
		await expect(promoter.promote(seeded.target)).resolves.toMatchObject({
			nextLedger: '64',
			replayed: false
		});
		expect(await canonicalCounts(seeded.proofId)).toEqual({
			batches: 1,
			ledgers: 63,
			results: 0,
			transactions: 0
		});
	});

	it('rejects non-verified proof and a different requested network', async () => {
		const pending = await seedPromotionCandidate(dataSource, {
			networkPassphrase: 'Promotion pending proof network',
			seed: 103
		});
		await dataSource.query(
			`update "history_archive_checkpoint_proof" set status = 'pending'
			where id = $1`,
			[pending.proofId]
		);
		await expect(promoter.promote(pending.target)).rejects.toMatchObject({
			reason: 'invalid-proof'
		});
		expect(await canonicalCounts(pending.proofId)).toMatchObject({
			batches: 0
		});

		const network = await seedPromotionCandidate(dataSource, {
			networkPassphrase: 'Promotion exact passphrase network',
			seed: 104
		});
		await expect(
			promoter.promote({
				...network.target,
				networkPassphrase: 'Forged network passphrase'
			})
		).rejects.toMatchObject({ reason: 'invalid-network-passphrase' });
		expect(await canonicalCounts(network.proofId)).toMatchObject({
			batches: 0
		});
	});

	it('rejects a proof without checkpoint-state ledger binding', async () => {
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: 'Promotion ledger-binding fixture network',
			seed: 110
		});
		await dataSource.query(
			`update "history_archive_checkpoint_proof"
			 set details = details - 'checkpointStateLedgerMatches'
			 where id = $1`,
			[seeded.proofId]
		);

		await expect(promoter.promote(seeded.target)).rejects.toMatchObject({
			reason: 'invalid-proof'
		});
		await expect(canonicalCounts(seeded.proofId)).resolves.toMatchObject({
			batches: 0
		});
	});

	it('rejects missing exact-object observations despite unrelated decoys', async () => {
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: 'Promotion exact observation network',
			seed: 105
		});
		await dataSource.query(
			`delete from "parsed_ledger_header_observation"
			where "sourceObjectRemoteId" = $1
				and "parsedLedgerHeaderId" in (
					select id from "parsed_ledger_header" where "ledgerSequence" = 1
				)`,
			[seeded.sourceIds.ledger]
		);
		await expect(promoter.promote(seeded.target)).rejects.toMatchObject({
			reason: 'candidate-incomplete'
		});
		expect(await canonicalCounts(seeded.proofId)).toMatchObject({ batches: 0 });
	});

	it('rejects malformed content digest evidence on an exact proof source object', async () => {
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: 'Promotion digest fixture network',
			seed: 111
		});
		await dataSource.query(
			`update "history_archive_object_queue"
			set "verificationFacts" = jsonb_set(
				"verificationFacts", '{content,digest}', '"not-a-digest"'::jsonb
			)
			where "remoteId" = $1`,
			[seeded.sourceIds.ledger]
		);
		await expect(promoter.promote(seeded.target)).rejects.toMatchObject({
			reason: 'invalid-source-evidence'
		});
		expect(await canonicalCounts(seeded.proofId)).toMatchObject({ batches: 0 });
	});

	it('rejects a real result moved away from its exact ledger/index pair', async () => {
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: publicNetworkPassphrase,
			seed: 106,
			transaction: readClassicArchiveTransactionFixture()
		});
		await dataSource.query(
			`update "parsed_transaction_result" set "transactionIndex" = 1
			where id in (
				select "parsedTransactionResultId"
				from "parsed_transaction_result_observation"
				where "sourceObjectRemoteId" = $1
			)`,
			[seeded.sourceIds.results]
		);
		await expect(promoter.promote(seeded.target)).rejects.toMatchObject({
			reason: 'transaction-pairing-mismatch'
		});
		expect(await canonicalCounts(seeded.proofId)).toMatchObject({ batches: 0 });
	});

	it('rejects partial transaction staging even when both paired observations are absent', async () => {
		const seeded = await seedPromotionCandidate(dataSource, {
			networkPassphrase: publicNetworkPassphrase,
			seed: 109,
			transaction: readClassicArchiveTransactionFixture()
		});
		await dataSource.query(
			`delete from "parsed_transaction_envelope_observation"
			where "sourceObjectRemoteId" = $1`,
			[seeded.sourceIds.transactions]
		);
		await dataSource.query(
			`delete from "parsed_transaction_result_observation"
			where "sourceObjectRemoteId" = $1`,
			[seeded.sourceIds.results]
		);
		await expect(promoter.promote(seeded.target)).rejects.toMatchObject({
			reason: 'category-hash-mismatch'
		});
		expect(await canonicalCounts(seeded.proofId)).toMatchObject({ batches: 0 });
	});

	it('rejects a checkpoint gap after a committed genesis watermark', async () => {
		const networkPassphrase = 'Promotion gap fixture network';
		const genesis = await seedPromotionCandidate(dataSource, {
			networkPassphrase,
			seed: 107
		});
		const skipped = await seedPromotionCandidate(dataSource, {
			checkpointLedger: 191,
			networkPassphrase,
			seed: 108
		});
		await promoter.promote(genesis.target);
		await expect(promoter.promote(skipped.target)).rejects.toMatchObject({
			reason: 'watermark-gap'
		});
		expect(await canonicalCounts(skipped.proofId)).toMatchObject({
			batches: 0
		});
	});

	async function canonicalCounts(proofId: number): Promise<{
		readonly batches: number;
		readonly ledgers: number;
		readonly results: number;
		readonly transactions: number;
	}> {
		const rows = (await dataSource.query(
			`select
				count(*)::integer as batches,
				coalesce(sum(batch.ledger_count), 0)::integer as ledgers,
				coalesce(sum(batch.transaction_count), 0)::integer as transactions,
				coalesce(sum(batch.result_count), 0)::integer as results
			from "full_history_ingestion_batch" batch
			where batch.checkpoint_proof_id = $1`,
			[proofId]
		)) as Array<{
			readonly batches: number;
			readonly ledgers: number;
			readonly results: number;
			readonly transactions: number;
		}>;
		return rows[0]!;
	}

	async function expectExactStoredProvenance(proofId: number): Promise<void> {
		const rows = (await dataSource.query(
			`select
				batch.checkpoint_state_object_remote_id::text as "checkpointStateId",
				batch.ledger_object_remote_id::text as "ledgerId",
				batch.transactions_object_remote_id::text as "transactionsId",
				batch.results_object_remote_id::text as "resultsId",
				encode(batch.ledger_content_digest, 'hex') as "storedDigest",
				source."verificationFacts" -> 'content' ->> 'digest' as "sourceDigest"
			from "full_history_ingestion_batch" batch
			join "history_archive_object_queue" source
				on source."remoteId" = batch.ledger_object_remote_id
			where batch.checkpoint_proof_id = $1`,
			[proofId]
		)) as Array<{
			readonly checkpointStateId: string;
			readonly ledgerId: string;
			readonly resultsId: string;
			readonly sourceDigest: string;
			readonly storedDigest: string;
			readonly transactionsId: string;
		}>;
		expect(rows[0]?.storedDigest).toBe(rows[0]?.sourceDigest);
		expect(new Set(Object.values(rows[0] ?? {}))).not.toContain(undefined);
		expect(
			new Set([
				rows[0]?.checkpointStateId,
				rows[0]?.ledgerId,
				rows[0]?.transactionsId,
				rows[0]?.resultsId
			]).size
		).toBe(4);
	}
});
