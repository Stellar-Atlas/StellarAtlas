import { mock } from 'jest-mock-extended';
import type { GetExplorerLocalTransactions } from '../../get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import type { ExplorerLocalTransactionsDTO } from '../../get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import {
	GetExplorerRecentTransactions,
	type ExplorerLiveTransactionFeed
} from '../GetExplorerRecentTransactions.js';

const now = new Date('2026-08-01T12:00:00.000Z');
const freshnessWindowMs = 5 * 60 * 1_000;

describe('GetExplorerRecentTransactions', () => {
	it('uses local history only when the covered ledger is inside the SLO', async () => {
		const local = mock<Pick<GetExplorerLocalTransactions, 'execute'>>();
		local.execute.mockResolvedValue(localFeed('2026-08-01T11:55:00.000Z'));
		const fetchLiveTransactions = jest.fn<
			Promise<ExplorerLiveTransactionFeed>,
			[number]
		>();

		const result = await createUseCase(local, fetchLiveTransactions).execute(
			20
		);

		expect(result).toEqual({
			dataThrough: '2026-08-01T11:55:00.000Z',
			freshness: 'fresh',
			freshnessThresholdMs: freshnessWindowMs,
			generatedAt: now.toISOString(),
			limit: 20,
			records: [publicTransaction()],
			selectionReason: 'local_history_current',
			source: 'local_history',
			truncated: true
		});
		expect(fetchLiveTransactions).not.toHaveBeenCalled();
	});

	it('uses live network rows when local history is outside the SLO', async () => {
		const local = mock<Pick<GetExplorerLocalTransactions, 'execute'>>();
		local.execute.mockResolvedValue(localFeed('2026-08-01T11:54:59.999Z'));
		const fetchLiveTransactions = jest.fn<
			Promise<ExplorerLiveTransactionFeed>,
			[number]
		>();
		fetchLiveTransactions.mockResolvedValue({
			records: [liveTransaction('2026-08-01T11:59:30.000Z')],
			truncated: false
		});

		const result = await createUseCase(local, fetchLiveTransactions).execute(
			20
		);

		expect(result).toMatchObject({
			dataThrough: '2026-08-01T11:59:30.000Z',
			freshness: 'fresh',
			selectionReason: 'local_history_behind',
			source: 'live_network'
		});
		expect(result.records).toEqual([
			liveTransaction('2026-08-01T11:59:30.000Z')
		]);
	});

	it('returns explicitly stale local rows when live network refresh fails', async () => {
		const local = mock<Pick<GetExplorerLocalTransactions, 'execute'>>();
		local.execute.mockResolvedValue(localFeed('2026-08-01T11:00:00.000Z'));
		const fetchLiveTransactions = jest.fn<
			Promise<ExplorerLiveTransactionFeed>,
			[number]
		>();
		fetchLiveTransactions.mockRejectedValue(new Error('network unavailable'));

		const result = await createUseCase(local, fetchLiveTransactions).execute(
			20
		);

		expect(result).toMatchObject({
			dataThrough: '2026-08-01T11:00:00.000Z',
			freshness: 'stale',
			selectionReason: 'live_network_unavailable',
			source: 'local_history'
		});
	});

	it('propagates live network failure when no local rows can be returned', async () => {
		const local = mock<Pick<GetExplorerLocalTransactions, 'execute'>>();
		local.execute.mockResolvedValue(localFeed(null, []));
		const fetchLiveTransactions = jest.fn<
			Promise<ExplorerLiveTransactionFeed>,
			[number]
		>();
		const error = new Error('network unavailable');
		fetchLiveTransactions.mockRejectedValue(error);

		await expect(
			createUseCase(local, fetchLiveTransactions).execute(20)
		).rejects.toBe(error);
	});
});

function createUseCase(
	local: Pick<GetExplorerLocalTransactions, 'execute'>,
	fetchLiveTransactions: (limit: number) => Promise<ExplorerLiveTransactionFeed>
): GetExplorerRecentTransactions {
	return new GetExplorerRecentTransactions({
		fetchLiveTransactions,
		freshnessWindowMs,
		getLocalTransactions: local,
		now: () => now
	});
}

function localFeed(
	latestLedgerClosedAt: string | null,
	records: ExplorerLocalTransactionsDTO['records'] = [localTransaction()]
): ExplorerLocalTransactionsDTO {
	return {
		canonicalCoverage:
			latestLedgerClosedAt === null
				? null
				: canonicalCoverage(latestLedgerClosedAt),
		count: records.length,
		generatedAt: now.toISOString(),
		limit: 20,
		readModel: {
			assetIndexReady: false,
			contractIndexReady: false,
			evidenceSelection: 'proof_gated_canonical_transaction_and_result',
			operationIndexReady: true,
			transactionIndexReady: records.length > 0
		},
		records,
		source: 'postgres_canonical',
		truncated: records.length > 0
	};
}

function canonicalCoverage(
	latestLedgerClosedAt: string
): NonNullable<ExplorerLocalTransactionsDTO['canonicalCoverage']> {
	const sourceObject = {
		algorithm: 'sha256' as const,
		contentDigest: '1'.repeat(64),
		objectRemoteId: '00000000-0000-4000-8000-000000000001',
		representation: 'uncompressed-xdr' as const
	};
	return {
		archiveSourceCount: 1,
		batchCount: 1,
		firstLedger: '64',
		lastLedger: '127',
		latestEvidence: {
			archiveUrlIdentity: 'history.example',
			batchId: '00000000-0000-4000-8000-000000000002',
			checkpointLedger: '127',
			checkpointProofId: 1,
			decoderVersion: 'test',
			firstLedger: '64',
			ingestedAt: now.toISOString(),
			lastLedger: '127',
			proofEvaluatedAt: now.toISOString(),
			proofVersion: 5,
			sourceObjects: {
				checkpointState: {
					...sourceObject,
					representation: 'canonical-json'
				},
				ledger: sourceObject,
				results: sourceObject,
				transactions: sourceObject
			}
		},
		latestLedgerClosedAt,
		ledgerCount: 64,
		nextLedger: '128',
		rangeKind: 'contiguous_bounded',
		source: 'postgres_canonical',
		transactionCount: 1,
		transactionResultCount: 1,
		updatedAt: now.toISOString()
	};
}

function localTransaction(): ExplorerLocalTransactionsDTO['records'][number] {
	return {
		...publicTransaction(),
		source: 'postgres_canonical'
	};
}

function liveTransaction(
	createdAt: string
): ExplorerLiveTransactionFeed['records'][number] {
	return { ...publicTransaction('b'), createdAt };
}

function publicTransaction(seed = 'a') {
	return {
		createdAt: '2026-08-01T11:55:00.000Z',
		feeCharged: '100',
		hash: seed.repeat(64),
		ledger: '123',
		operationCount: 1,
		sourceAccount: `G${seed.toUpperCase().repeat(55)}`,
		successful: true
	};
}
