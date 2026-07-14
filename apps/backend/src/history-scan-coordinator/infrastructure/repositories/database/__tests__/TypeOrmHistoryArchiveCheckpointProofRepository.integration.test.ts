import { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import { HistoryArchiveCheckpointProof } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { HistoryArchiveObject } from '../../../../domain/history-archive-object/HistoryArchiveObject.js';
import { publicNetworkPassphrase } from '../../../../domain/history-archive-object/HistoryArchiveObjectScpPolicy.js';
import { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
import {
	createProofDataSource,
	createLedgerFact as ledgerFact,
	createProofObject as proofObject,
	deleteProofObject,
	exerciseFlakyProofRefresh,
	mutateProofFacts,
	proofArchiveUrl as archiveUrl,
	proofBucketHash as bucketHash,
	proofCheckpointLedger as checkpointLedger,
	refreshAndLoadProof,
	saveDuplicateProofLedger,
	saveProofFixture as saveFixture
} from './HistoryArchiveCheckpointProofFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(90_000);

describe('TypeOrmHistoryArchiveCheckpointProofRepository disposable PostgreSQL', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;
	let repository: TypeOrmHistoryArchiveCheckpointProofRepository;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		({ dataSource, repository } = await createProofDataSource(postgres.url));
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(
			'truncate table history_archive_checkpoint_proof, history_archive_object_queue, history_archive_checkpoint_bucket_dependency restart identity cascade'
		);
		await saveFixture(dataSource);
	});

	it('verifies exactly one complete 64-ledger checkpoint window', async () => {
		const proof = await refreshAndLoad();

		expect(proof).toMatchObject({
			bucketsVerified: true,
			checkpointBucketListMatches: true,
			ledgerFactCount: 64,
			previousLedgersMatch: true,
			proofFactsComplete: true,
			proofVersion: 6,
			resultFactCount: 64,
			resultsMatch: true,
			status: 'verified',
			transactionFactCount: 64,
			transactionsMatch: true
		});
		expect(proof?.details).toMatchObject({
			checkpointStateLedgerFactPresent: true,
			checkpointStateLedgerMatches: true,
			expectedLedgerCount: 64,
			expectsScp: true,
			maxProtocolVersion: 22,
			networkPassphrase: publicNetworkPassphrase
		});
	});

	it('rejects a checkpoint-state fact bound to another checkpoint', async () => {
		await dataSource.query(
			`update history_archive_object_queue
			 set "verificationFacts" = jsonb_set(
				"verificationFacts",
				'{checkpointHistoryArchiveStateFact,checkpointLedger}',
				to_jsonb(($2 + 64)::integer)
			 )
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'checkpoint-state'
				and "checkpointLedger" = $2`,
			[archiveUrl, checkpointLedger]
		);

		const proof = await refreshAndLoad();
		expect(proof).toMatchObject({
			failureKind: 'checkpoint-ledger-mismatch',
			proofFactsComplete: false,
			proofVersion: 6,
			status: 'mismatch'
		});
		expect(proof?.details).toMatchObject({
			checkpointStateLedgerFactPresent: true,
			checkpointStateLedgerMatches: false
		});
	});

	it('verifies the 63-ledger genesis checkpoint without ledger zero', async () => {
		await dataSource.query(
			'truncate table history_archive_checkpoint_proof, history_archive_object_queue, history_archive_checkpoint_bucket_dependency restart identity cascade'
		);
		await saveFixture(dataSource, { checkpointLedger: 63 });

		const proof = await refreshAndLoad(63);

		expect(proof).toMatchObject({
			ledgerFactCount: 63,
			previousLedgersMatch: true,
			proofFactsComplete: true,
			resultFactCount: 63,
			status: 'verified',
			transactionFactCount: 63
		});
		expect(proof?.details).toMatchObject({
			expectedLedgerCount: 63,
			predecessorBoundaryValid: true,
			predecessorMissing: false
		});
	});

	it('keeps a checkpoint non-evaluable when one ledger fact is missing', async () => {
		await mutateFacts('ledger', (facts) => facts.slice(1));

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			ledgerFactCount: 63,
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
	});

	it('rejects a 65-entry category even when its 64-ledger range is complete', async () => {
		await mutateFacts('ledger', (facts) => [
			...facts,
			{ ...facts[0], ledger: checkpointLedger + 1 }
		]);

		const proof = await refreshAndLoad();
		expect(proof).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
		expect(proof?.details).toMatchObject({ ledgerRawFactCount: 65 });
	});

	it('rejects duplicate and out-of-range ledger cardinality', async () => {
		await mutateFacts('ledger', (facts) => [
			{ ...facts[0], ledger: checkpointLedger + 1 },
			{ ...facts[0] },
			...facts.slice(2)
		]);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			ledgerFactCount: 64,
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
	});

	it('keeps a checkpoint pending when a required category row is missing', async () => {
		await deleteObject('transactions');

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'object-incomplete',
			requiredObjectsComplete: false,
			status: 'pending'
		});
	});

	it('does not choose a convenient duplicate category object', async () => {
		await saveDuplicateProofLedger(dataSource);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'object-incomplete',
			requiredObjectsComplete: false,
			status: 'pending'
		});
	});

	it('requires SCP from network/checkpoint semantics even when its row is absent', async () => {
		await deleteObject('scp');

		const proof = await refreshAndLoad();
		expect(proof).toMatchObject({
			failureKind: 'object-incomplete',
			requiredObjectsComplete: false,
			status: 'pending'
		});
		expect(proof?.details).toMatchObject({ expectsScp: true });
	});

	it('requires nonempty SCP facts when protocol semantics expect SCP', async () => {
		await dataSource.query(
			`update history_archive_object_queue
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", '{scpCategory,entryCount}', '0'::jsonb
			 )
			 where "archiveUrlIdentity" = $1 and "objectType" = 'scp'`,
			[archiveUrl]
		);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
	});

	it('requires category source facts to match queue object URLs', async () => {
		await dataSource.query(
			`update history_archive_object_queue
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", '{ledgerCategory,sourceUrl}',
				to_jsonb('https://wrong.example/ledger.xdr.gz'::text)
			 )
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'ledger'
				and "checkpointLedger" = $2`,
			[archiveUrl, checkpointLedger]
		);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
	});

	it('requires bucket source facts to match queue object URLs', async () => {
		await dataSource.query(
			`update history_archive_object_queue
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", '{bucketObject,sourceUrl}',
				to_jsonb('https://wrong.example/bucket.xdr.gz'::text)
			 )
			 where "archiveUrlIdentity" = $1 and "objectType" = 'bucket'`,
			[archiveUrl]
		);

		expect(await refreshAndLoad()).toMatchObject({
			bucketsVerified: false,
			failureKind: 'bucket-missing',
			status: 'not-evaluable'
		});
	});

	it('does not verify when early-network SCP expectation lacks protocol facts', async () => {
		const earlyCheckpointLedger = 127;
		await dataSource.query(
			'truncate table history_archive_checkpoint_proof, history_archive_object_queue, history_archive_checkpoint_bucket_dependency restart identity cascade'
		);
		await saveFixture(dataSource, {
			checkpointLedger: earlyCheckpointLedger,
			networkPassphrase: 'Private integration network',
			protocolVersion: null
		});

		const proof = await refreshAndLoad(earlyCheckpointLedger);
		expect(proof).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
		expect(proof?.details).toMatchObject({ scpExpectationKnown: false });
	});

	it('keeps a checkpoint non-evaluable when a referenced bucket is missing', async () => {
		await deleteObject('bucket');

		expect(await refreshAndLoad()).toMatchObject({
			bucketsVerified: false,
			failureKind: 'bucket-missing',
			missingBucketCount: 1,
			status: 'not-evaluable'
		});
	});

	it('requires matched bucket verification facts, not verified status alone', async () => {
		await dataSource.query(
			`update history_archive_object_queue
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", '{bucketObject,matched}', 'false'::jsonb
			 )
			 where "archiveUrlIdentity" = $1 and "objectType" = 'bucket'`,
			[archiveUrl]
		);

		expect(await refreshAndLoad()).toMatchObject({
			bucketsVerified: false,
			failureKind: 'bucket-missing',
			missingBucketCount: 1,
			status: 'not-evaluable'
		});
	});

	it('detects a wrong transaction hash', async () => {
		await mutateFacts('transactions', (facts) => [
			{ ...facts[0], hash: 'wrong-transaction-hash' },
			...facts.slice(1)
		]);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'transaction-hash-mismatch',
			status: 'mismatch',
			transactionsMatch: false
		});
	});

	it('detects a wrong result hash', async () => {
		await mutateFacts('results', (facts) => [
			{ ...facts[0], hash: 'wrong-result-hash' },
			...facts.slice(1)
		]);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'result-hash-mismatch',
			resultsMatch: false,
			status: 'mismatch'
		});
	});

	it('requires continuity with the previous checkpoint boundary', async () => {
		await mutateFacts('ledger', (facts) => [
			{ ...facts[0], previousLedgerHeaderHash: 'wrong-boundary-hash' },
			...facts.slice(1)
		]);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'previous-ledger-hash-mismatch',
			previousLedgersMatch: false,
			status: 'mismatch'
		});
	});

	it('treats a missing predecessor as pending evidence', async () => {
		await dataSource.query(
			`delete from history_archive_object_queue
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'ledger'
				and "checkpointLedger" = $2`,
			[archiveUrl, checkpointLedger - 64]
		);

		expect(await refreshAndLoad()).toMatchObject({
			failureKind: 'predecessor-missing',
			previousLedgersMatch: false,
			status: 'pending'
		});
	});

	it('refreshes the immediate successor when its predecessor arrives', async () => {
		const predecessorLedger = checkpointLedger - 64;
		await dataSource.query(
			`delete from history_archive_object_queue
			 where "archiveUrlIdentity" = $1
				and "objectType" = 'ledger'
				and "checkpointLedger" = $2`,
			[archiveUrl, predecessorLedger]
		);
		await refreshAndLoad();
		const predecessor = proofObject('ledger', predecessorLedger, {
			ledgerCategory: {
				entryCount: 1,
				ledgers: [ledgerFact(predecessorLedger, checkpointLedger, 22)]
			}
		});
		await dataSource.getRepository(HistoryArchiveObject).save(predecessor);

		await repository.refreshForObject(predecessor);
		const successor = await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.findOneByOrFail({ archiveUrlIdentity: archiveUrl, checkpointLedger });
		expect(successor).toMatchObject({ failureKind: null, status: 'verified' });
	});

	it('preserves the failed object error type and HTTP status in proof details', async () => {
		await dataSource.query(
			`
			update history_archive_object_queue
			set status = 'failed',
				"errorType" = 'archive_http_error',
				"errorMessage" = 'HTTP 503 Service Unavailable',
				"failureChannel" = 'archive_evidence',
				"httpStatus" = 503
			where "archiveUrlIdentity" = $1 and "objectType" = 'bucket'
			`,
			[archiveUrl]
		);

		const proof = await refreshAndLoad();
		expect(proof).toMatchObject({
			failedBucketCount: 1,
			failureKind: 'object-failed',
			status: 'not-evaluable'
		});
		expect(proof?.details).toMatchObject({
			failureChannel: 'archive_evidence',
			failureErrorType: 'archive_http_error',
			failureHttpStatus: 503,
			objectFailures: [
				expect.objectContaining({
					errorType: 'archive_http_error',
					failureChannel: 'archive_evidence',
					httpStatus: 503,
					objectType: 'bucket'
				})
			]
		});
	});

	it('reports mixed failure channels without choosing one by sort order', async () => {
		await dataSource.query(
			`
			update history_archive_object_queue
			set status = 'failed',
				"errorType" = case "objectType"
					when 'bucket' then 'bucket_hash_mismatch'
					else 'worker_pool_failure'
				end,
				"errorMessage" = 'fixture failure',
				"failureChannel" = case "objectType"
					when 'bucket' then 'archive_evidence'
					else 'scanner_issue'
				end,
				"httpStatus" = case "objectType" when 'bucket' then 200 else null end
			where "archiveUrlIdentity" = $1
				and "objectType" in ('bucket', 'ledger')
			`,
			[archiveUrl]
		);

		const proof = await refreshAndLoad();
		expect(proof).toMatchObject({
			failureKind: 'object-failed',
			status: 'not-evaluable'
		});
		expect(proof?.details).toMatchObject({
			failureChannel: null,
			failureChannels: ['archive_evidence', 'scanner_issue'],
			failureErrorType: null,
			failureHttpStatus: null,
			objectFailures: expect.arrayContaining([
				expect.objectContaining({ failureChannel: 'archive_evidence' }),
				expect.objectContaining({ failureChannel: 'scanner_issue' })
			])
		});
	});

	it('retries durable proof refresh after the failure transaction commits', async () => {
		const {
			failedObject,
			failure,
			flakyProofRepository,
			objectRepository,
			useCase
		} = await exerciseFlakyProofRefresh(dataSource, repository);
		expect(failedObject).toMatchObject({ attempts: 1, status: 'scanning' });
		const firstResult = await useCase.execute(failedObject.remoteId, failure);
		expect(firstResult._unsafeUnwrap()).toBe(true);
		const persistedFailure = await objectRepository.findByRemoteId(
			failedObject.remoteId
		);
		expect(persistedFailure).toMatchObject({
			status: 'failed',
			transitionEffectsCompletedAt: null,
			transitionEffectsRequiredAt: expect.any(Date)
		});
		if (persistedFailure === null) throw new Error('Missing persisted failure');
		await expect(useCase.reconcilePersisted(persistedFailure)).rejects.toThrow(
			'transient proof refresh failure'
		);
		const retryFailure = await objectRepository.findByRemoteId(
			failedObject.remoteId
		);
		if (retryFailure === null) throw new Error('Missing retryable failure');
		await useCase.reconcilePersisted(retryFailure);
		const proof = await dataSource
			.getRepository(HistoryArchiveCheckpointProof)
			.findOneByOrFail({ archiveUrlIdentity: archiveUrl, checkpointLedger });
		expect(
			await objectRepository.findByRemoteId(failedObject.remoteId)
		).toMatchObject({ transitionEffectsCompletedAt: expect.any(Date) });
		expect(flakyProofRepository.refreshForObject).toHaveBeenCalledTimes(2);
		expect(proof).toMatchObject({
			failureKind: 'object-failed',
			status: 'not-evaluable'
		});
		expect(proof.details).toMatchObject({
			failureErrorType: 'bucket_verification_failed',
			failureHttpStatus: 200
		});
	});

	async function refreshAndLoad(
		targetCheckpointLedger = checkpointLedger
	): Promise<HistoryArchiveCheckpointProof | null> {
		return await refreshAndLoadProof(
			dataSource,
			repository,
			targetCheckpointLedger
		);
	}

	async function deleteObject(objectType: string): Promise<void> {
		await deleteProofObject(dataSource, objectType);
	}

	async function mutateFacts(
		objectType: 'ledger' | 'transactions' | 'results',
		mutate: (
			facts: Array<Record<string, unknown>>
		) => Array<Record<string, unknown>>
	): Promise<void> {
		await mutateProofFacts(dataSource, objectType, mutate);
	}
});
