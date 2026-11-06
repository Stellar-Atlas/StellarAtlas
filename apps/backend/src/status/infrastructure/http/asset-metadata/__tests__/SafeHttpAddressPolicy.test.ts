import { validatePublicHttpsUrl } from '../safeHttp.js';

it.each([
	'192.0.2.1',
	'192.31.196.1',
	'192.52.193.1',
	'192.88.99.2',
	'192.175.48.1',
	'198.51.100.1',
	'203.0.113.1',
	'100.127.255.255',
	'224.0.0.1',
	'[::ffff:8.8.8.8]',
	'[64:ff9b::a00:1]',
	'[2001:1ff::1]',
	'[2001:db8::1]',
	'[2002::1]',
	'[2620:4f:8000::1]',
	'[3ffe::1]',
	'[3fff:fff::1]',
	'[5f00::1]',
	'[fc00::1]'
])('rejects special-purpose address %s without DNS or HTTPS', async (host) => {
	await expect(validatePublicHttpsUrl(`https://${host}/`)).rejects.toThrow(
		'non-public'
	);
});

it.each(['1.1.1.1', '8.8.8.8', '[2606:4700::1111]', '[2001:4860:4860::8888]'])(
	'allows ordinary public unicast address %s without connecting',
	async (host) => {
		await expect(
			validatePublicHttpsUrl(`https://${host}/`)
		).resolves.toHaveProperty('hostname', host);
	}
);
