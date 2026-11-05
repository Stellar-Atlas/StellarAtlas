import { jest } from '@jest/globals';
import { GET } from '../[account]/route';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const path = 'https://stellaratlas.invalid/api/explorer/current-account/';

it('forwards just one checksum-valid account to the configured API and rejects widened requests', async () => {
	const configured = process.env.STELLAR_ATLAS_PUBLIC_API_URL;
	process.env.STELLAR_ATLAS_PUBLIC_API_URL = 'http://127.0.0.1:3099';
	const upstream = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
		Response.json({ account_id: account, balances: [] }));
	const timeout = jest.spyOn(AbortSignal, 'timeout');
	try {
		const params = Promise.resolve({ account });
		const response = await GET(new Request(path + account), { params });
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ account_id: account, balances: [] });
		expect(upstream).toHaveBeenCalledTimes(1);
		expect(timeout).toHaveBeenCalledWith(65_000);
		expect(upstream).toHaveBeenCalledWith('http://127.0.0.1:3099/horizon/accounts/' + account,
			expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
		expect((await GET(new Request(path + account + '?limit=100'), { params })).status).toBe(400);
		const malformed = 'G' + 'A'.repeat(55);
		expect((await GET(new Request(path + malformed), { params: Promise.resolve({ account: malformed }) })).status).toBe(400);
		expect(upstream).toHaveBeenCalledTimes(1);
	} finally {
		timeout.mockRestore();
		upstream.mockRestore();
		if (configured === undefined) delete process.env.STELLAR_ATLAS_PUBLIC_API_URL;
		else process.env.STELLAR_ATLAS_PUBLIC_API_URL = configured;
	}
});
