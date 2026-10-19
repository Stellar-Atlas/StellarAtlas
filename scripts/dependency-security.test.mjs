import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const backendRequire = createRequire(
	new URL('../apps/backend/package.json', import.meta.url)
);
const frontendRequire = createRequire(
	new URL('../apps/frontend-v4/package.json', import.meta.url)
);
const sharedRequire = createRequire(
	new URL('../packages/shared/package.json', import.meta.url)
);
const rootRequire = createRequire(new URL('../package.json', import.meta.url));
const schemaRequire = createRequire(
	sharedRequire.resolve('typescript-json-schema')
);
const ajvRequire = createRequire(backendRequire.resolve('ajv'));
const expressRequire = createRequire(backendRequire.resolve('express'));
const tsJestRequire = createRequire(rootRequire.resolve('ts-jest'));
const concurrentlyRequire = createRequire(rootRequire.resolve('concurrently'));
const toml = backendRequire('toml');
const { VM, NodeVM } = schemaRequire('vm2');
const proxyAddr = expressRequire('proxy-addr');

function assertVersionAtLeast(actual, minimum) {
	const parts = actual.split('.').map(Number);
	assert.equal(parts.length, 3, 'Expected a stable three-part release');
	assert.ok(parts.every(Number.isSafeInteger), 'Do not accept prereleases');
	const expected = minimum.split('.').map(Number);
	const differing = parts.findIndex((part, index) => part !== expected[index]);
	assert.ok(
		differing < 0 || parts[differing] > expected[differing],
		`${actual} must be at least ${minimum}`
	);
}

test('effective runtime and schema-tool versions contain the reviewed fixes', () => {
	assertVersionAtLeast(backendRequire('toml/package.json').version, '4.2.0');
	assertVersionAtLeast(schemaRequire('vm2/package.json').version, '3.12.2');
	assertVersionAtLeast(ajvRequire('fast-uri/package.json').version, '3.1.6');
	assertVersionAtLeast(frontendRequire('next/package.json').version, '16.4.2');
	assertVersionAtLeast(expressRequire('proxy-addr/package.json').version, '2.0.8');
	assertVersionAtLeast(tsJestRequire('handlebars/package.json').version, '4.7.10');
	assertVersionAtLeast(concurrentlyRequire('shell-quote/package.json').version, '1.12.0');
});

test('proxy-addr normalizes IPv4-mapped IPv6 addresses for trusted ranges', () => {
	const loopback = proxyAddr.compile('127.0.0.1/32');
	assert.equal(loopback('::ffff:127.0.0.1'), true);
	assert.equal(loopback('::ffff:127.0.0.2'), false);

	const privateNetwork = proxyAddr.compile('10.0.0.0/8');
	assert.equal(privateNetwork('::ffff:10.1.2.3'), true);
	assert.equal(privateNetwork('::ffff:11.1.2.3'), false);
});

test('the schema sandbox remains usable without exposing dangerous host builtins', () => {
	assert.equal(new VM().run('1 + 2'), 3);
	for (const builtin of ['os', 'dns', 'dns/promises']) {
		const vm = new NodeVM({
			console: 'off',
			require: { external: false, builtin: ['*'] }
		});
		assert.throws(() => vm.run(`module.exports = require('${builtin}')`));
	}
});

test('TOML parsing preserves expected validator and organization metadata', () => {
	const parsed = toml.parse(
		'[DOCUMENTATION]\nORG_NAME = "Example"\n' +
			'[[VALIDATORS]]\nALIAS = "validator-01"\n' +
			'HISTORY = "https://archive.example/history"\n'
	);
	assert.equal(parsed.DOCUMENTATION.ORG_NAME, 'Example');
	assert.equal(parsed.VALIDATORS[0].ALIAS, 'validator-01');
	assert.equal(parsed.VALIDATORS[0].HISTORY, 'https://archive.example/history');
});

test('TOML input cannot write a prototype property', () => {
	assert.equal(Object.prototype.archiveSecurityProbe, undefined);
	try {
		toml.parse('[__proto__]\narchiveSecurityProbe = true\n');
	} catch (error) {
		assert.equal(error.name, 'SyntaxError');
	}
	assert.equal(Object.prototype.archiveSecurityProbe, undefined);
});

test('deep TOML arrays hit the parser depth limit rather than stack exhaustion', () => {
	assert.throws(
		() => toml.parse('value = ' + '['.repeat(2_000) + '0' + ']'.repeat(2_000)),
		(error) =>
			error instanceof Error &&
			!(error instanceof RangeError) &&
			/Maximum nesting depth of 500 exceeded/.test(error.message)
	);
});
