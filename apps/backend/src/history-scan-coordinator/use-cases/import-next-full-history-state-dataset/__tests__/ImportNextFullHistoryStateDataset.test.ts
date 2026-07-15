import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fullHistoryLedgerCloseMetaSha256Digest } from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryAccountStateChange } from '../../../domain/full-history-state-import/FullHistoryStateExport.js';
import type {
	FullHistoryStateImportClaim,
	FullHistoryStateImportRepository
} from '../../../domain/full-history-state-import/FullHistoryStateImport.js';
import {
	ImportNextFullHistoryStateDataset,
	type FullHistoryStateExporter
} from '../ImportNextFullHistoryStateDataset.js';

describe('ImportNextFullHistoryStateDataset', () => {
	let root: string;
	const bytes = Buffer.from('typed parquet fixture');

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'stellaratlas-state-import-'));
		await writeFile(join(root, 'account.parquet'), bytes);
	});

	afterEach(async () => {
		await rm(root, { force: true, recursive: true });
	});

	it('verifies source bytes, batches rows, and completes exact counts', async () => {
		const claim = accountClaim(digest(bytes), 3n);
		const repository = new RecordingRepository(claim);
		const exporter: FullHistoryStateExporter = {
			export: async ({ consumeRow, inputPath }) => {
				expect(inputPath).toBe(join(root, 'account.parquet'));
				for (let index = 1; index <= 3; index += 1) {
					await consumeRow(accountRow(index));
				}
				return 3n;
			}
		};
		const useCase = new ImportNextFullHistoryStateDataset(
			repository,
			exporter,
			config(root, 2)
		);

		await expect(
			useCase.execute(new AbortController().signal)
		).resolves.toEqual({
			batchId: claim.batchId,
			dataset: 'account-state-changes',
			recordCount: 3n
		});
		expect(repository.accountBatchSizes).toEqual([2, 1]);
		expect(repository.completed).toBe(3n);
		expect(repository.failed).toBeNull();
		expect(repository.renewals).toBeGreaterThanOrEqual(1);
	});

	it('records a source digest failure without invoking the exporter', async () => {
		const claim = accountClaim(digest(Buffer.from('different')), 0n);
		const repository = new RecordingRepository(claim);
		const exporter: FullHistoryStateExporter = {
			export: jest.fn(() => Promise.resolve(0n))
		};
		const useCase = new ImportNextFullHistoryStateDataset(
			repository,
			exporter,
			config(root, 2)
		);

		await expect(useCase.execute(new AbortController().signal)).rejects.toThrow(
			'digest'
		);
		expect(exporter.export).not.toHaveBeenCalled();
		expect(repository.failed?.message).toContain('digest');
	});

	it('returns idle only after registering newly published datasets', async () => {
		const repository = new RecordingRepository(null);
		const useCase = new ImportNextFullHistoryStateDataset(
			repository,
			{ export: () => Promise.reject(new Error('must not run')) },
			config(root, 2)
		);
		await expect(
			useCase.execute(new AbortController().signal)
		).resolves.toBeNull();
		expect(repository.registrations).toBe(1);
	});
});

class RecordingRepository implements FullHistoryStateImportRepository {
	readonly accountBatchSizes: number[] = [];
	completed: bigint | null = null;
	failed: Error | null = null;
	registrations = 0;
	renewals = 0;

	constructor(private readonly claim: FullHistoryStateImportClaim | null) {}

	claimNext(): Promise<FullHistoryStateImportClaim | null> {
		return Promise.resolve(this.claim);
	}

	complete(
		_claim: FullHistoryStateImportClaim,
		recordCount: bigint
	): Promise<void> {
		this.completed = recordCount;
		return Promise.resolve();
	}

	fail(_claim: FullHistoryStateImportClaim, error: Error): Promise<void> {
		this.failed = error;
		return Promise.resolve();
	}

	registerPendingImports(): Promise<number> {
		this.registrations += 1;
		return Promise.resolve(1);
	}

	renewLease(): Promise<void> {
		this.renewals += 1;
		return Promise.resolve();
	}

	storeAccountRows(
		_claim: FullHistoryStateImportClaim,
		rows: readonly FullHistoryAccountStateChange[]
	): Promise<void> {
		this.accountBatchSizes.push(rows.length);
		return Promise.resolve();
	}

	storeTrustlineRows(): Promise<void> {
		throw new Error('Unexpected trustline rows');
	}
}

function accountClaim(
	sourceSha256: ReturnType<typeof fullHistoryLedgerCloseMetaSha256Digest>,
	expectedRecordCount: bigint
): FullHistoryStateImportClaim {
	return Object.freeze({
		batchId: randomUUID(),
		dataset: 'account-state-changes',
		endLedger: 66,
		expectedRecordCount,
		leaseOwner: randomUUID(),
		sourceSha256,
		startLedger: 3,
		storageKey: 'account.parquet'
	});
}

function config(storageRoot: string, insertBatchSize: number) {
	return {
		insertBatchSize,
		leaseDurationMilliseconds: 30_000,
		storageRoot,
		workerId: randomUUID()
	};
}

function digest(value: Uint8Array) {
	return fullHistoryLedgerCloseMetaSha256Digest(
		createHash('sha256').update(value).digest('hex')
	);
}

function accountRow(changeIndex: number): FullHistoryAccountStateChange {
	return Object.freeze({
		accountId: `G${'A'.repeat(55)}`,
		balance: '1',
		buyingLiabilities: '0',
		changeIndex: changeIndex.toString(),
		changeType: 1,
		changeTypeString: 'LedgerEntryChangeTypeLedgerEntryUpdated',
		closedAtUnixMillis: '1',
		deleted: false,
		flags: '0',
		highThreshold: 1,
		homeDomain: '',
		inflationDestination: null,
		lastModifiedLedger: '3',
		ledgerKeySha256: 'a'.repeat(64),
		ledgerSequence: '3',
		lowThreshold: 1,
		masterWeight: 1,
		mediumThreshold: 1,
		operationIndex: '1',
		reason: 'operation',
		sellingLiabilities: '0',
		sequenceLedger: null,
		sequenceNumber: '1',
		sequenceTime: null,
		signerCount: '0',
		signerKeys: [],
		signerSponsors: [],
		signerWeights: [],
		sponsor: null,
		sponsoredEntryCount: '0',
		sponsoringEntryCount: '0',
		stateEntryXdrBase64: 'AQ==',
		subentryCount: '0',
		transactionHash: 'b'.repeat(64),
		transactionIndex: '1',
		upgradeIndex: null
	});
}
