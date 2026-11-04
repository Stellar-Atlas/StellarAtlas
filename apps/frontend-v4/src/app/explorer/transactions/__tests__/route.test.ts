import { GET, HEAD } from '../route';

it('redirects the bare transaction collection to the existing Explorer without caching', async () => {
	const request = new Request('https://stellaratlas.io/explorer/transactions');
	const response = GET(request);
	expect(response.status).toBe(307);
	expect(response.headers.get('location')).toBe('/explorer');
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.text()).toBe('');
});

it('preserves shared search parameters and never uses them or the request host as a destination', () => {
	const query = '?search=KALE%3AISSUER&search_type=asset&filter=a&filter=b&next=%2F%2Fexample.invalid&extra=%0D%0A';
	const request = new Request('https://www.stellaratlas.io/explorer/transactions' + query, { method: 'HEAD' });
	const response = HEAD(request);
	expect(response.status).toBe(307);
	expect(response.headers.get('location')).toBe('/explorer' + query);
});
