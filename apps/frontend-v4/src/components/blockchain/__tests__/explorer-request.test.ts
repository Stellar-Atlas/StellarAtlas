import { executeExplorerRequest } from '../explorer-request';

describe('explorer request containment', () => {
	it('returns loaded data unchanged', async () => {
		const value = { status: 'loaded', records: ['one'] };
		await expect(
			executeExplorerRequest(async () => value, 'Unavailable')
		).resolves.toEqual({ ok: true, value });
	});

	it('contains thrown action errors without exposing internal details', async () => {
		await expect(
			executeExplorerRequest(async () => {
				throw new Error('internal transport stack and credentials');
			}, 'Search could not be completed.')
		).resolves.toEqual({
			ok: false,
			message: 'Search could not be completed.'
		});
	});

	it('does not supply replacement data when a refresh is unavailable', async () => {
		const result = await executeExplorerRequest(
			async () => ({
				status: 'unavailable',
				message: 'Indexer is catching up.',
				records: null
			}),
			'Unavailable'
		);
		expect(result).toEqual({ ok: false, message: 'Indexer is catching up.' });
		expect(result).not.toHaveProperty('value');
	});

	it('keeps invalid query feedback as a displayable action result', async () => {
		const value = { status: 'invalid', message: 'Enter a transaction hash.' };
		await expect(
			executeExplorerRequest(async () => value, 'Unavailable')
		).resolves.toEqual({ ok: true, value });
	});

	it('provides a safe retry message when the API omits one', async () => {
		await expect(
			executeExplorerRequest(
				async () => ({
					status: 'unavailable',
					message: null
				}),
				'Unavailable'
			)
		).resolves.toEqual({
			ok: false,
			message: 'The data service is unavailable. Please try again.'
		});
	});
});
