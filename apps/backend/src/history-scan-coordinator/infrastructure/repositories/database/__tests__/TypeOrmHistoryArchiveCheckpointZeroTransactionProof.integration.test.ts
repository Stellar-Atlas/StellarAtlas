import { createHash } from 'node:crypto';
import { xdr } from '@stellar/stellar-sdk';
import { DataSource } from 'typeorm';
import { TypeOrmHistoryArchiveCheckpointProofRepository } from '../TypeOrmHistoryArchiveCheckpointProofRepository.js';
import {
	createProofDataSource,
	mutateProofFacts,
	proofArchiveUrl,
	proofCheckpointLedger,
	refreshAndLoadProof,
	saveProofFixture
} from './HistoryArchiveCheckpointProofFixture.js';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';

jest.setTimeout(90_000);

describe('archive proof for zero-transaction ledger category frames', () => {
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
		await saveProofFixture(dataSource);
	});

	it('proves absent category frames for a protocol-26 zero-transaction ledger', async () => {
		const zeroTransactionLedger = proofCheckpointLedger - 1;
		const previousLedgerHeaderHash = Buffer.alloc(32, 7).toString('base64');
		await mutateProofFacts(dataSource, 'ledger', (facts) =>
			facts.map((fact) =>
				fact.ledger === zeroTransactionLedger - 1
					? { ...fact, ledgerHeaderHash: previousLedgerHeaderHash }
					: fact.ledger === zeroTransactionLedger
						? {
								...fact,
								previousLedgerHeaderHash,
								protocolVersion: 26,
								transactionResultSetHash:
									'3z9hmASpL9tAVxktxD3XSOp3itxSvEmM6AUkwBS4ERk=',
								transactionSetHash: protocol26EmptyTransactionSetHash(
									previousLedgerHeaderHash
								)
							}
						: fact
			)
		);
		for (const objectType of ['transactions', 'results'] as const) {
			await mutateProofFacts(dataSource, objectType, (facts) =>
				facts.filter((fact) => fact.ledger !== zeroTransactionLedger)
			);
			await setCategoryEntryCount(objectType, 63);
		}

		const proof = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);

		expect(proof).toMatchObject({
			proofFactsComplete: true,
			resultFactCount: 63,
			resultsMatch: true,
			status: 'verified',
			transactionFactCount: 63,
			transactionsMatch: true
		});
	});

	it('rejects an omitted transaction frame when results are not empty', async () => {
		const zeroTransactionLedger = proofCheckpointLedger - 1;
		const previousLedgerHeaderHash = Buffer.alloc(32, 9).toString('base64');
		await mutateProofFacts(dataSource, 'ledger', (facts) =>
			facts.map((fact) =>
				fact.ledger === zeroTransactionLedger - 1
					? { ...fact, ledgerHeaderHash: previousLedgerHeaderHash }
					: fact.ledger === zeroTransactionLedger
						? {
								...fact,
								previousLedgerHeaderHash,
								protocolVersion: 26,
								transactionSetHash: protocol26EmptyTransactionSetHash(
									previousLedgerHeaderHash
								)
							}
						: fact
			)
		);
		await mutateProofFacts(dataSource, 'transactions', (facts) =>
			facts.filter((fact) => fact.ledger !== zeroTransactionLedger)
		);
		await setCategoryEntryCount('transactions', 63);

		const proof = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);

		expect(proof).toMatchObject({
			failureKind: 'transaction-hash-mismatch',
			status: 'mismatch',
			transactionsMatch: false
		});
	});

	it('rejects a missing ledger header even when both category frames are absent', async () => {
		const missingLedger = proofCheckpointLedger - 1;
		await mutateProofFacts(dataSource, 'ledger', (facts) =>
			facts.filter((fact) => fact.ledger !== missingLedger)
		);
		for (const objectType of ['transactions', 'results'] as const) {
			await mutateProofFacts(dataSource, objectType, (facts) =>
				facts.filter((fact) => fact.ledger !== missingLedger)
			);
			await setCategoryEntryCount(objectType, 63);
		}

		const proof = await refreshAndLoadProof(
			dataSource,
			repository,
			proofCheckpointLedger
		);

		expect(proof).toMatchObject({
			failureKind: 'proof-facts-incomplete',
			ledgerFactCount: 63,
			proofFactsComplete: false,
			status: 'not-evaluable'
		});
	});

	async function setCategoryEntryCount(
		objectType: 'transactions' | 'results',
		entryCount: number
	): Promise<void> {
		await dataSource.query(
			`update history_archive_object_queue
			 set "verificationFacts" = jsonb_set(
				"verificationFacts", $3::text[], to_jsonb($4::integer)
			 )
			 where "archiveUrlIdentity" = $1
				and "objectType" = $2
				and "checkpointLedger" = $5`,
			[
				proofArchiveUrl,
				objectType,
				[`${objectType}Category`, 'entryCount'],
				entryCount,
				proofCheckpointLedger
			]
		);
	}
});

function protocol26EmptyTransactionSetHash(
	previousLedgerHeaderHash: string
): string {
	const classicPhase = new xdr.TransactionPhase(0, []);
	const parallelPhase = new xdr.TransactionPhase(
		1,
		new xdr.ParallelTxsComponent({ baseFee: null, executionStages: [] })
	);
	const transactionSet = new xdr.TransactionSetV1({
		phases: [classicPhase, parallelPhase],
		previousLedgerHash: Buffer.from(previousLedgerHeaderHash, 'base64')
	});
	return createHash('sha256')
		.update(new xdr.GeneralizedTransactionSet(1, transactionSet).toXDR())
		.digest('base64');
}
