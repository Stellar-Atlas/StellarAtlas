import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assertStellarRuntimeVersions,
	requiredProtocolVersion
} from './check-stellar-runtime-versions.mjs';

const versions = {
	core: 'stellar-core 29.0.0 (official)\nledger protocol version: 29\nledger protocol version: 28',
	horizon: '29.0.0-official\ngo1.25.14',
	rpc: 'stellar-rpc 29.0.0-official'
};

test('accepts matching binary versions and actual Core capability', () => {
	assert.deepEqual(assertStellarRuntimeVersions(versions, 29), {
		protocol: 29,
		core: 29,
		horizon: 29,
		rpc: 29
	});
});
test('rejects old Core capability even if the binary label says 29', () => {
	assert.throws(
		() =>
			assertStellarRuntimeVersions(
				{
					...versions,
					core: 'stellar-core 29.0.0\nledger protocol version: 28'
				},
				29
			),
		/mismatch/
	);
});
test('rejects an old captive wrapper', () => {
	assert.throws(
		() =>
			assertStellarRuntimeVersions(
				{ ...versions, rpc: 'stellar-rpc 28.0.1' },
				29
			),
		/mismatch/
	);
	assert.throws(
		() => assertStellarRuntimeVersions({ ...versions, horizon: '28.0.1' }, 29),
		/mismatch/
	);
});
test('does not silently accept another protocol or unparseable output', () => {
	assert.throws(() => assertStellarRuntimeVersions(versions, 28), /mismatch/);
	assert.throws(
		() => assertStellarRuntimeVersions({ ...versions, core: '' }, 29),
		/unknown/
	);
});
test('keeps setup entrypoints working with one default protocol and validates overrides', () => {
	assert.equal(requiredProtocolVersion([]), 29);
	assert.equal(requiredProtocolVersion(['--protocol', '29']), 29);
	for (const args of [
		['--protocol'],
		['--protocol', '0'],
		['--protocol', '28oops']
	]) {
		assert.throws(() => requiredProtocolVersion(args), /positive integer/);
	}
});
