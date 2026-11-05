import { jest } from '@jest/globals';
import { GET } from '../[account]/route';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const path = 'https://atlas.invalid/api/explorer/claimable-positions/' + account;

it('is off by default and forwards only the scoped role and opaque cursor when enabled', async () => {
	const flag = process.env.STELLAR_ATLAS_ACCOUNT_CLAIMABLE_POSITIONS;
	const base = process.env.STELLAR_ATLAS_PUBLIC_API_URL;
	const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
		Response.json({ positions: [] }));
	const params = Promise.resolve({ account });
	try {
		delete process.env.STELLAR_ATLAS_ACCOUNT_CLAIMABLE_POSITIONS;
		expect((await GET(new Request(path + '?role=claimant'), { params })).status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
		process.env.STELLAR_ATLAS_ACCOUNT_CLAIMABLE_POSITIONS = '1';
		process.env.STELLAR_ATLAS_PUBLIC_API_URL = 'http://127.0.0.1:3099';
		for (const query of ['', '?role=claimant&role=sponsor', '?role=claimant&limit=999', '?role=sponsor&cursor=%2Fsomewhere']) {
			expect((await GET(new Request(path + query), { params })).status).toBe(400);
		}
		const response = await GET(new Request(path + '?role=sponsor&cursor=Abc-_'), { params });
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ positions: [] });
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3099/v1/explorer/accounts/' + account + '/claimable-positions?role=sponsor&cursor=Abc-_',
			expect.objectContaining({ cache: 'no-store', redirect: 'error', signal: expect.any(AbortSignal) }));
	} finally {
		fetch.mockRestore();
		if (flag === undefined) delete process.env.STELLAR_ATLAS_ACCOUNT_CLAIMABLE_POSITIONS;
		else process.env.STELLAR_ATLAS_ACCOUNT_CLAIMABLE_POSITIONS = flag;
		if (base === undefined) delete process.env.STELLAR_ATLAS_PUBLIC_API_URL;
		else process.env.STELLAR_ATLAS_PUBLIC_API_URL = base;
	}
});
