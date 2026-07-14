import express from 'express';
import { mock } from 'jest-mock-extended';
import request from 'supertest';
import type { GetExplorerLocalLedgers } from '../../../use-cases/get-explorer-local-ledgers/GetExplorerLocalLedgers.js';
import { explorerLocalLedgerRouter } from '../ExplorerLocalLedgerRouter.js';

describe('ExplorerLocalLedgerRouter.integration', () => {
	it('serves an exact canonical ledger without an external request', async () => {
		const useCase = ledgerUseCase();
		useCase.findBySequence.mockResolvedValue(availableLookup());
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildApp(useCase))
			.get('/v1/explorer/local-ledgers/63386240')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					ledger: {
						evidence: { checkpointProofId: 41 },
						freshness: {
							ingestedAt: '2026-07-08T16:11:00.000Z'
						},
						sequence: '63386240',
						source: 'postgres_canonical'
					},
					status: 'available'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('distinguishes a covered miss from unavailable partial coverage', async () => {
		const notFoundUseCase = ledgerUseCase();
		notFoundUseCase.findBySequence.mockResolvedValue({
			canonicalCoverage: canonicalCoverage,
			generatedAt: '2026-07-12T04:00:00.000Z',
			reason: 'ledger_absent_within_canonical_coverage',
			requestedRange: {
				firstLedger: '63386240',
				lastLedger: '63386240'
			},
			source: 'postgres_canonical',
			status: 'not_found'
		});
		await request(buildApp(notFoundUseCase))
			.get('/v1/explorer/local-ledgers/63386240')
			.expect(404)
			.expect((response) => {
				expect(response.body.status).toBe('not_found');
			});

		const unavailableUseCase = ledgerUseCase();
		unavailableUseCase.findBySequence.mockResolvedValue({
			canonicalCoverage,
			generatedAt: '2026-07-12T04:00:00.000Z',
			reason: 'outside_canonical_coverage',
			requestedRange: {
				firstLedger: '63386239',
				lastLedger: '63386239'
			},
			source: 'postgres_canonical',
			status: 'unavailable'
		});
		await request(buildApp(unavailableUseCase))
			.get('/v1/explorer/local-ledgers/63386239')
			.expect(503)
			.expect((response) => {
				expect(response.body).toMatchObject({
					reason: 'outside_canonical_coverage',
					status: 'unavailable'
				});
			});
	});

	it('serves only complete bounded ranges and rejects invalid input', async () => {
		const useCase = ledgerUseCase();
		useCase.findRange.mockResolvedValue({
			canonicalCoverage,
			count: 2,
			generatedAt: '2026-07-12T04:00:00.000Z',
			records: [canonicalLedger, { ...canonicalLedger, sequence: '63386241' }],
			requestedRange: {
				firstLedger: '63386240',
				lastLedger: '63386241'
			},
			source: 'postgres_canonical',
			status: 'available'
		});

		await request(buildApp(useCase))
			.get(
				'/v1/explorer/local-ledgers?firstLedger=63386240&lastLedger=63386241'
			)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({ count: 2, status: 'available' });
			});
		expect(useCase.findRange).toHaveBeenCalledWith({
			firstLedger: '63386240',
			lastLedger: '63386241'
		});

		await request(buildApp(useCase))
			.get('/v1/explorer/local-ledgers?firstLedger=1&lastLedger=101')
			.expect(400);
		await request(buildApp(useCase))
			.get('/v1/explorer/local-ledgers?firstLedger=2&lastLedger=1')
			.expect(400);
		expect(useCase.findRange).toHaveBeenCalledTimes(1);
	});
});

function ledgerUseCase() {
	return mock<Pick<GetExplorerLocalLedgers, 'findBySequence' | 'findRange'>>();
}

function buildApp(useCase: ReturnType<typeof ledgerUseCase>) {
	const app = express();
	app.use(
		'/v1/explorer/local-ledgers',
		explorerLocalLedgerRouter({ getExplorerLocalLedgers: useCase })
	);
	return app;
}

function availableLookup() {
	return {
		canonicalCoverage,
		generatedAt: '2026-07-12T04:00:00.000Z',
		ledger: canonicalLedger,
		requestedRange: {
			firstLedger: '63386240',
			lastLedger: '63386240'
		},
		source: 'postgres_canonical' as const,
		status: 'available' as const
	};
}

const canonicalLedger = {
	bucketListHash: '5'.repeat(64),
	closedAt: '2026-07-08T16:09:36.000Z',
	evidence: {
		archiveSource: 'archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: '63386303',
		checkpointProofId: 41,
		decoderVersion: 'canonical-decoder/1',
		proofVersion: 5,
		sourceObject: {
			algorithm: 'sha256' as const,
			contentDigest: '6'.repeat(64),
			objectRemoteId: '00000000-0000-4000-8000-000000000003',
			representation: 'uncompressed-xdr' as const
		}
	},
	freshness: {
		ingestedAt: '2026-07-08T16:11:00.000Z',
		proofEvaluatedAt: '2026-07-08T16:10:00.000Z'
	},
	hash: '1'.repeat(64),
	operationCount: 27,
	previousLedgerHash: '2'.repeat(64),
	protocolVersion: 27,
	sequence: '63386240',
	source: 'postgres_canonical' as const,
	transactionCount: 11,
	transactionResultHash: '3'.repeat(64),
	transactionSetHash: '4'.repeat(64)
};

const canonicalCoverage = {
	archiveSourceCount: 1,
	batchCount: 1,
	firstLedger: '63386240',
	lastLedger: '63386303',
	latestEvidence: {
		archiveUrlIdentity: 'archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: '63386303',
		checkpointProofId: 41,
		decoderVersion: 'canonical-decoder/1',
		firstLedger: '63386240',
		ingestedAt: '2026-07-08T16:11:00.000Z',
		lastLedger: '63386303',
		proofEvaluatedAt: '2026-07-08T16:10:00.000Z',
		proofVersion: 5,
		sourceObjects: {
			checkpointState: sourceObject('7', '2', 'canonical-json'),
			ledger: sourceObject('6', '3', 'uncompressed-xdr'),
			results: sourceObject('8', '5', 'uncompressed-xdr'),
			transactions: sourceObject('9', '4', 'uncompressed-xdr')
		}
	},
	latestLedgerClosedAt: '2026-07-08T16:09:36.000Z',
	ledgerCount: 64,
	nextLedger: '63386304',
	rangeKind: 'contiguous_bounded' as const,
	source: 'postgres_canonical' as const,
	transactionCount: 26158,
	transactionResultCount: 26158,
	updatedAt: '2026-07-12T03:19:10.000Z'
};

function sourceObject(
	seed: string,
	suffix: string,
	representation: 'canonical-json' | 'uncompressed-xdr'
) {
	return {
		algorithm: 'sha256' as const,
		contentDigest: seed.repeat(64),
		objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
		representation
	};
}
