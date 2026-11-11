// Offline, dependency-free: node --experimental-strip-types <this file>.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createPublicArchiveLookup,
	isPublicArchiveAddress,
	isPublicArchivePolicyError,
	publicArchiveRequestConfig,
	requirePublicArchiveUrl,
	validatePublicArchiveRedirect
} from '../PublicArchivePolicy.ts';

test('blocks private/special-use literal addresses, mapped IPv6, alternate IPv4 forms and unsafe URLs', () => {
	for (const host of [
		'0.0.0.0',
		'10.1.2.3',
		'100.64.0.1',
		'127.0.0.1',
		'169.254.169.254',
		'172.16.0.1',
		'192.168.1.1',
		'192.0.2.1',
		'198.18.0.1',
		'224.0.0.1',
		'255.255.255.255',
		'[::]',
		'[::1]',
		'[::ffff:127.0.0.1]',
		'[::ffff:8.8.8.8]',
		'[fc00::1]',
		'[fe80::1]',
		'[2001:db8::1]',
		'[2002::1]',
		'[64:ff9b::a00:1]',
		'2130706433',
		'0x7f000001',
		'127.1'
	]) {
		assert.throws(
			() => requirePublicArchiveUrl(`http://${host}/`),
			{ code: 'PUBLIC_ARCHIVE_POLICY' },
			host
		);
	}
	for (const url of [
		'http://localhost/',
		'https://sub.localhost/',
		'http://8.8.8.8:3000/',
		'https://8.8.8.8:80/',
		'http://user:pass@8.8.8.8/',
		'file:///tmp/x',
		'http://8.8.8.8/#fragment',
		'http://8.8.8.8/\\internal',
		'http://8.8.8.8/\n'
	])
		assert.throws(
			() => requirePublicArchiveUrl(url),
			{ code: 'PUBLIC_ARCHIVE_POLICY' },
			url
		);
});

test('preserves public HTTP/HTTPS archive paths and signed queries', () => {
	for (const url of [
		'http://8.8.8.8/path?X-Signature=a%2Fb&Expires=1',
		'https://archive.example/path?token=a%2Bb',
		'https://[2606:4700::1111]/archive'
	])
		assert.equal(requirePublicArchiveUrl(url).href, url);
	assert.equal(isPublicArchiveAddress('8.8.8.8'), true);
	assert.equal(isPublicArchiveAddress('2606:4700::1111'), true);
	assert.equal(isPublicArchiveAddress('invalid'), false);
});

function resolveThrough(lookup, hostname, options = {}) {
	return new Promise((resolve, reject) =>
		lookup(hostname, options, (error, address, family) =>
			error ? reject(error) : resolve({ address, family })
		)
	);
}

test('pins the same validated DNS results into the connection without a second lookup', async () => {
	let calls = 0;
	const lookup = createPublicArchiveLookup((_hostname, options, callback) => {
		calls++;
		assert.equal(options.all, true);
		callback(null, [
			{ address: calls === 1 ? '8.8.8.8' : '127.0.0.1', family: 4 }
		]);
	});
	assert.deepEqual(await resolveThrough(lookup, 'archive.example'), {
		address: '8.8.8.8',
		family: 4
	});
	assert.equal(calls, 1);
	await assert.rejects(resolveThrough(lookup, 'archive.example'), {
		code: 'PUBLIC_ARCHIVE_POLICY'
	});
	assert.equal(calls, 2);
});

test('fails closed for mixed public/private answers, empty DNS and incompatible families', async () => {
	for (const records of [
		[],
		[
			{ address: '8.8.8.8', family: 4 },
			{ address: '10.0.0.1', family: 4 }
		],
		[{ address: '::ffff:127.0.0.1', family: 6 }]
	]) {
		const lookup = createPublicArchiveLookup((_hostname, _options, callback) =>
			callback(null, records)
		);
		await assert.rejects(
			resolveThrough(lookup, 'archive.example', { all: true }),
			{ code: 'PUBLIC_ARCHIVE_POLICY' }
		);
	}
	const lookup = createPublicArchiveLookup((_hostname, _options, callback) =>
		callback(null, [{ address: '8.8.8.8', family: 4 }])
	);
	await assert.rejects(
		resolveThrough(lookup, 'archive.example', { family: 6 }),
		{ code: 'PUBLIC_ARCHIVE_POLICY' }
	);
	assert.deepEqual(
		await resolveThrough(lookup, 'archive.example', { all: true }),
		{ address: [{ address: '8.8.8.8', family: 4 }], family: undefined }
	);
});

test('checks each redirect destination and keeps proxy/agents/redirect limits under policy ownership', () => {
	const config = publicArchiveRequestConfig({
		publicArchive: true,
		maxRedirects: 100,
		maxContentLength: 10_000_000
	});
	assert.equal(config.proxy, false);
	assert.equal(config.maxRedirects, 3);
	assert.equal(config.maxContentLength, 1024 * 1024);
	assert.equal(typeof config.httpAgent.options.lookup, 'function');
	assert.equal(typeof config.httpsAgent.options.lookup, 'function');
	for (const target of [
		{ protocol: 'http:', hostname: '127.0.0.1' },
		{ protocol: 'https:', hostname: '[::ffff:10.0.0.1]' },
		{ protocol: 'http:', hostname: '8.8.8.8', port: '8080' },
		{ protocol: 'https:', hostname: 'archive.example', auth: 'user:secret' }
	])
		assert.throws(() => config.beforeRedirect(target), {
			code: 'PUBLIC_ARCHIVE_POLICY'
		});
	validatePublicArchiveRedirect({
		protocol: 'http:',
		hostname: 'archive.example',
		port: 80
	});
	validatePublicArchiveRedirect({
		protocol: 'https:',
		hostname: '2606:4700::1111',
		port: 443
	});
	assert.equal(publicArchiveRequestConfig({ maxRedirects: 0 }).maxRedirects, 0);
	assert.equal(publicArchiveRequestConfig({ maxContentLength: 0 }).maxContentLength, 0);
	for (const field of ['maxRedirects', 'maxContentLength']) {
		for (const value of [-1, NaN, Infinity, -Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
			assert.throws(() => publicArchiveRequestConfig({ [field]: value }),
				{ code: 'PUBLIC_ARCHIVE_POLICY' });
			assert.throws(() => publicArchiveRequestConfig({ responseType: 'stream', [field]: value }),
				{ code: 'PUBLIC_ARCHIVE_POLICY' });
		}
	}
	assert.equal(
		publicArchiveRequestConfig({ maxContentLength: 65_536 }).maxContentLength,
		65_536
	);
});

test('preserves large archive streaming and identifies wrapped policy failures as worker policy', () => {
	const config = publicArchiveRequestConfig({ responseType: 'stream' });
	assert.equal(config.maxContentLength, undefined);
	assert.equal(
		isPublicArchivePolicyError({ cause: { code: 'PUBLIC_ARCHIVE_POLICY' } }),
		true
	);
	assert.equal(isPublicArchivePolicyError({ code: 'ERR_NETWORK' }), false);
	assert.throws(
		() =>
			publicArchiveRequestConfig({
				auth: { username: 'name', password: 'secret' }
			}),
		{ code: 'PUBLIC_ARCHIVE_POLICY' }
	);
});
