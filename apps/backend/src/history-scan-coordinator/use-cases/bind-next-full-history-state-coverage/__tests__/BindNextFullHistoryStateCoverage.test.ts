import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fullHistoryLedgerCloseMetaSha256Digest } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type {
	FullHistoryLedgerProjection,
	FullHistoryStateCanonicalCoverageClaim,
	FullHistoryStateCanonicalCoverageReceipt,
	FullHistoryStateCanonicalCoverageRepository
} from '../../../domain/full-history-state-import/FullHistoryLedgerProjection.js';
import {
	BindNextFullHistoryStateCoverage,
	type FullHistoryLedgerExporter
} from '../BindNextFullHistoryStateCoverage.js';

const fixtureBytes = Buffer.from('ledger parquet fixture');

describe('BindNextFullHistoryStateCoverage', () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'stellaratlas-coverage-'));
		await writeFile(join(root, 'ledgers.parquet'), fixtureBytes);
	});

	afterEach(async () => {
		await rm(root, { force: true, recursive: true });
	});

	it('verifies bytes and binds one contiguous ledger projection', async () => {
		const claim = coverageClaim();
		const repository = new RecordingCoverageRepository(claim);
		const exporter: FullHistoryLedgerExporter = {
			export: async ({ consumeRow, inputPath }) => {
				expect(inputPath).toBe(join(root, 'ledgers.parquet'));
				await consumeRow(ledgerRow('3'));
				return {
					recordCount: 1n,
					sourceSha256: claim.ledgerSourceSha256
				};
			}
		};
		const useCase = new BindNextFullHistoryStateCoverage(
			repository,
			exporter,
			config(root)
		);

		await expect(
			useCase.execute(new AbortController().signal)
		).resolves.toEqual(repository.receipt);
		expect(repository.rows).toEqual([ledgerRow('3')]);
		expect(repository.completed).toBe(1n);
		expect(repository.failed).toBeNull();
	});

	it('refuses a non-contiguous or overlong export and records retry evidence', async () => {
		const claim = coverageClaim();
		const repository = new RecordingCoverageRepository(claim);
		const useCase = new BindNextFullHistoryStateCoverage(
			repository,
			{
				export: async ({ consumeRow }) => {
					await consumeRow(ledgerRow('4'));
					return {
						recordCount: 1n,
						sourceSha256: claim.ledgerSourceSha256
					};
				}
			},
			config(root)
		);
		await expect(useCase.execute(new AbortController().signal)).rejects.toThrow(
			/contiguous/i
		);
		expect(repository.failed?.message).toContain('contiguous');
	});

	it('refuses a ledger source digest that differs from the manifest', async () => {
		const claim = coverageClaim();
		const repository = new RecordingCoverageRepository(claim);
		const useCase = new BindNextFullHistoryStateCoverage(
			repository,
			{
				export: () =>
					Promise.resolve({
						recordCount: 0n,
						sourceSha256: fullHistoryLedgerCloseMetaSha256Digest('f'.repeat(64))
					})
			},
			config(root)
		);

		await expect(useCase.execute(new AbortController().signal)).rejects.toThrow(
			'source digest'
		);
		expect(repository.completed).toBeNull();
		expect(repository.failed?.message).toContain('source digest');
	});
});

class RecordingCoverageRepository implements FullHistoryStateCanonicalCoverageRepository {
	readonly receipt: FullHistoryStateCanonicalCoverageReceipt;
	readonly rows: FullHistoryLedgerProjection[] = [];
	completed: bigint | null = null;
	failed: Error | null = null;

	constructor(private readonly claim: FullHistoryStateCanonicalCoverageClaim) {
		this.receipt = {
			batchId: claim.batchId,
			canonicalBatchCount: 1,
			ledgerCount: 1,
			minimumProofVersion: 6,
			status: 'complete'
		};
	}

	claimNext(): Promise<FullHistoryStateCanonicalCoverageClaim> {
		return Promise.resolve(this.claim);
	}

	complete(
		_claim: FullHistoryStateCanonicalCoverageClaim,
		count: bigint
	): Promise<FullHistoryStateCanonicalCoverageReceipt> {
		this.completed = count;
		return Promise.resolve(this.receipt);
	}

	fail(
		_claim: FullHistoryStateCanonicalCoverageClaim,
		error: Error
	): Promise<void> {
		this.failed = error;
		return Promise.resolve();
	}

	registerPendingCoverage(): Promise<number> {
		return Promise.resolve(1);
	}

	renewLease(): Promise<void> {
		return Promise.resolve();
	}

	storeLedgerRows(
		_claim: FullHistoryStateCanonicalCoverageClaim,
		rows: readonly FullHistoryLedgerProjection[]
	): Promise<void> {
		this.rows.push(...rows);
		return Promise.resolve();
	}
}

function coverageClaim(): FullHistoryStateCanonicalCoverageClaim {
	return Object.freeze({
		attemptCount: 1,
		batchId: randomUUID(),
		endLedger: 3,
		expectedLedgerCount: 1,
		leaseOwner: randomUUID(),
		ledgerSourceSha256: fullHistoryLedgerCloseMetaSha256Digest(
			createHash('sha256').update(fixtureBytes).digest('hex')
		),
		networkPassphraseHash: fullHistoryLedgerCloseMetaSha256Digest(
			'a'.repeat(64)
		),
		startLedger: 3,
		storageKey: 'ledgers.parquet'
	});
}

function config(storageRoot: string) {
	return {
		insertBatchSize: 2,
		leaseDurationMilliseconds: 30_000,
		storageRoot,
		workerId: randomUUID()
	};
}

function ledgerRow(sequence: string): FullHistoryLedgerProjection {
	return Object.freeze({
		bucketListHash: '5'.repeat(64),
		closedAtUnixMillis: '1784073600000',
		ledgerHash: '1'.repeat(64),
		ledgerSequence: sequence,
		previousLedgerHash: '2'.repeat(64),
		protocolVersion: 27,
		transactionCount: '0',
		transactionResultSetHash: '4'.repeat(64),
		transactionSetHash: '3'.repeat(64)
	});
}
