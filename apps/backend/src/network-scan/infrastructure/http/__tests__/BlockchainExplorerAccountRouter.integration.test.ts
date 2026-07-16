import request from 'supertest';
import type { ExplorerLocalAccountChangesDTO } from '../../../use-cases/get-explorer-local-account-changes/ExplorerLocalAccountChangeDTO.js';
import {
	buildTestApp,
	canonicalAccountObservation,
	canonicalSourceAccount
} from './BlockchainExplorerRouterTestFixture.js';

describe('BlockchainExplorerRouter local account observations', () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('serves direct account lookup from proof-gated local observations only', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');

		await request(buildTestApp())
			.get(`/v1/explorer/accounts/${canonicalSourceAccount}/observations`)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					accountId: canonicalSourceAccount,
					interpretation: 'historical_observations_not_current_state',
					source: 'postgres_proof_gated_lcm_account_changes',
					status: 'available',
					records: [
						{
							stateSemantics: 'observed_post_change_state'
						}
					]
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('returns unavailable coverage as a typed domain response', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');
		const unavailable = unavailableAccountObservation();

		await request(buildTestApp({ localAccountChanges: unavailable }))
			.get(`/v1/explorer/accounts/${canonicalSourceAccount}/observations`)
			.expect(200)
			.expect('Cache-Control', 'no-store')
			.expect((response) => {
				expect(response.body).toMatchObject({
					reason: 'complete_canonical_coverage_empty',
					status: 'unavailable'
				});
			});

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('rejects a checksum-invalid observation account before lookup', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');
		const invalid = `${canonicalSourceAccount.slice(0, -1)}A`;

		await request(buildTestApp())
			.get(`/v1/explorer/accounts/${invalid}/observations`)
			.expect(400);

		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('preserves the existing Horizon account response contract', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					account_id: canonicalSourceAccount,
					balances: [{ asset_type: 'native', balance: '100.0000000' }],
					last_modified_ledger: 63386303,
					sequence: '123',
					subentry_count: 1
				}),
				{ headers: { 'Content-Type': 'application/json' }, status: 200 }
			)
		);

		await request(buildTestApp())
			.get(`/v1/explorer/accounts/${canonicalSourceAccount}`)
			.expect(200)
			.expect((response) => {
				expect(response.body).toMatchObject({
					accountId: canonicalSourceAccount,
					balances: [{ assetType: 'native', balance: '100.0000000' }],
					sequence: '123',
					source: 'horizon',
					subentryCount: 1
				});
			});

		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('does not cache transient explorer search failures', async () => {
		jest
			.spyOn(global, 'fetch')
			.mockRejectedValue(new Error('temporary failure'));

		await request(buildTestApp())
			.get('/v1/explorer/search?query=USDC&type=asset')
			.expect(502)
			.expect('Cache-Control', 'no-store');
	});
});

function unavailableAccountObservation(): ExplorerLocalAccountChangesDTO {
	return {
		accountId: canonicalSourceAccount,
		count: 0,
		coverage: null,
		generatedAt: canonicalAccountObservation.generatedAt,
		interpretation: 'historical_observations_not_current_state',
		limit: 1,
		reason: 'complete_canonical_coverage_empty',
		records: [],
		source: 'postgres_proof_gated_lcm_account_changes',
		status: 'unavailable',
		truncated: false
	};
}
