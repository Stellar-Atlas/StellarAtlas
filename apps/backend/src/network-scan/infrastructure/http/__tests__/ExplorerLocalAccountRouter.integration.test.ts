import {
	encodeMuxedAccount,
	encodeMuxedAccountToAddress
} from '@stellar/stellar-sdk';
import express from 'express';
import { mock } from 'jest-mock-extended';
import request from 'supertest';
import type { GetExplorerLocalAccountChanges } from '../../../use-cases/get-explorer-local-account-changes/GetExplorerLocalAccountChanges.js';
import { accountId } from '../../../use-cases/get-explorer-local-account-changes/__tests__/ExplorerLocalAccountChangeTestFixture.js';
import { explorerLocalAccountRouter } from '../ExplorerLocalAccountRouter.js';

describe('ExplorerLocalAccountRouter.integration', () => {
	it('serves available historical observations with a default limit of one', async () => {
		const useCase = accountChangesUseCase();
		useCase.execute.mockResolvedValue({
			...baseResponse(),
			count: 1,
			coverage: latestCoverage,
			records: [],
			status: 'available',
			truncated: false
		});

		await request(buildApp(useCase))
			.get(`/v1/explorer/local-accounts/${accountId}/changes`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					interpretation: 'historical_observations_not_current_state',
					status: 'available'
				});
			});

		expect(useCase.execute).toHaveBeenCalledWith({ accountId, limit: 1 });
	});

	it('returns not_observed as evidence, and unavailable coverage as 503', async () => {
		const useCase = accountChangesUseCase();
		useCase.execute.mockResolvedValueOnce({
			...baseResponse(),
			count: 0,
			coverage: latestCoverage,
			reason: 'no_change_observed_in_complete_coverage',
			records: [],
			status: 'not_observed',
			truncated: false
		});
		await request(buildApp(useCase))
			.get(`/v1/explorer/local-accounts/${accountId}/changes?limit=5`)
			.expect(200)
			.expect((response) => {
				expect(response.body.status).toBe('not_observed');
			});

		useCase.execute.mockResolvedValueOnce({
			...baseResponse(),
			count: 0,
			coverage: null,
			reason: 'complete_canonical_coverage_empty',
			records: [],
			status: 'unavailable',
			truncated: false
		});
		await request(buildApp(useCase))
			.get(`/v1/explorer/local-accounts/${accountId}/changes`)
			.expect(503)
			.expect('Cache-Control', 'no-store')
			.expect((response) => {
				expect(response.body.status).toBe('unavailable');
			});
	});

	it('rejects malformed, muxed, and unbounded requests before the use case', async () => {
		const useCase = accountChangesUseCase();
		const muxedAccount = encodeMuxedAccountToAddress(
			encodeMuxedAccount(accountId, '7')
		);

		for (const path of [
			`/v1/explorer/local-accounts/${'G'.padEnd(56, 'A')}/changes`,
			`/v1/explorer/local-accounts/${muxedAccount}/changes`,
			`/v1/explorer/local-accounts/${accountId}/changes?limit=0`,
			`/v1/explorer/local-accounts/${accountId}/changes?limit=26`,
			`/v1/explorer/local-accounts/${accountId}/changes?limit=01`
		]) {
			await request(buildApp(useCase)).get(path).expect(400);
		}
		expect(useCase.execute).not.toHaveBeenCalled();
	});

	it('maps read failures to 502 without leaking database details', async () => {
		const useCase = accountChangesUseCase();
		useCase.execute.mockRejectedValue(new Error('relation detail'));

		await request(buildApp(useCase))
			.get(`/v1/explorer/local-accounts/${accountId}/changes`)
			.expect(502)
			.expect('Cache-Control', 'no-store')
			.expect({ error: 'Local account observations unavailable' });
	});
});

function accountChangesUseCase() {
	return mock<Pick<GetExplorerLocalAccountChanges, 'execute'>>();
}

function buildApp(useCase: ReturnType<typeof accountChangesUseCase>) {
	const app = express();
	app.use(
		'/v1/explorer/local-accounts',
		explorerLocalAccountRouter({ getExplorerLocalAccountChanges: useCase })
	);
	return app;
}

function baseResponse() {
	return {
		accountId,
		generatedAt: '2026-07-15T14:00:00.000Z',
		interpretation: 'historical_observations_not_current_state' as const,
		limit: 1,
		source: 'postgres_proof_gated_lcm_account_changes' as const
	};
}

const latestCoverage = {
	evidenceSelection: 'latest_complete_canonical_lcm_batch' as const,
	freshness: {
		canonicalCoverageCompletedAt: '2026-07-15T13:03:00.000Z',
		canonicalProofEvaluatedAt: '2026-07-15T13:02:30.000Z',
		latestCoveredLedgerClosedAt: '2026-07-15T13:00:00.000Z'
	},
	range: {
		batchId: '00000000-0000-4000-8000-000000000004',
		firstLedger: '63390080',
		lastLedger: '63390143',
		ledgerCount: 64
	}
};
